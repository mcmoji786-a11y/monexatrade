"use client";

import { useEffect, useState } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken, useAccount } from "./account";

/* Referral links, the weekly demo competition and demo take-profit / stop-loss orders. */

const REF_KEY = "mx.ref";
/** A referral link counts if the visitor signs up within this time. */
const REF_TTL_MS = 30 * 24 * 3600 * 1000;

async function call<T>(path: string, body?: unknown, auth = true): Promise<T> {
  const token = accessToken();
  if (auth && !token) throw new Error("Sign in first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

/* ---------------- Referrals ---------------- */

export const refLink = (code: string) => `${typeof window === "undefined" ? "" : window.location.origin}/?ref=${code}`;

/** Keeps a `?ref=` code from the address bar, then hands it to the gateway once the
 *  visitor has an account. Mounted once in the root layout. */
export function useReferralCapture() {
  const account = useAccount();
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref")?.trim().toLowerCase();
      if (code && /^[a-z0-9]{6,12}$/.test(code)) localStorage.setItem(REF_KEY, JSON.stringify({ code, at: Date.now() }));
    } catch {}
  }, []);
  const ready = account.status === "signed-in" && !!account.me;
  useEffect(() => {
    if (!ready) return;
    let saved: { code: string; at: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(REF_KEY) ?? "null");
    } catch {}
    if (!saved) return;
    const drop = () => {
      try {
        localStorage.removeItem(REF_KEY);
      } catch {}
    };
    if (Date.now() - saved.at > REF_TTL_MS) return drop();
    // One attempt: the gateway only accepts it for new accounts, so retrying gains nothing.
    call("/account/referral", { code: saved.code }).then(drop, drop);
  }, [ready]);
}

export type Referral = { code: string; invited: number; recent: string[] };

/** The signed-in user's referral code and how many people joined with it. */
export function useReferral() {
  const account = useAccount();
  const [data, setData] = useState<{ uid: string; ref: Referral } | null>(null);
  const uid = account.status === "signed-in" ? (account.me?.id ?? null) : null;
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    call<Referral>("/account/referral")
      .then((ref) => alive && setData({ uid, ref }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uid]);
  return data && data.uid === uid ? data.ref : null;
}

/* ---------------- Weekly competition ---------------- */

export type BoardRow = { rank: number; name: string; pct: number; realized_usd: number; trades: number; win_rate: number; best_usd: number; you: boolean };
export type Leaderboard = { from: number; to: number; now: number; start_usd: number; min_trades: number; leaders: BoardRow[] };

export function useLeaderboard(week: "current" | "last") {
  const [data, setData] = useState<{ week: string; board: Leaderboard | null; failed: boolean }>({ week, board: null, failed: false });
  const signedIn = useAccount().status === "signed-in";
  useEffect(() => {
    let alive = true;
    const load = () =>
      call<Leaderboard>(`/demo/leaderboard?week=${week}`, undefined, false)
        .then((board) => alive && setData({ week, board, failed: false }))
        .catch(() => alive && setData((d) => ({ week, board: d.week === week ? d.board : null, failed: true })));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [week, signedIn]);
  return data.week === week ? data : { week, board: null, failed: false };
}

/* ---------------- Take profit / stop loss ---------------- */

export type DemoRule = {
  id: number;
  mint: string;
  symbol: string;
  kind: "tp" | "sl";
  trigger_pct: number;
  trigger_price_usd: number;
  fraction: number;
  status: "open" | "filled" | "cancelled";
  note: string | null;
  created_at: string;
  done_at: string | null;
};

export const listRules = () => call<DemoRule[]>("/demo/orders");
export const createRule = (r: { mint: string; kind: "tp" | "sl"; pct: number; fraction?: number }) => call<DemoRule>("/demo/orders", r);
export const cancelRule = (id: number) => call(`/demo/orders/${id}/cancel`, {});
