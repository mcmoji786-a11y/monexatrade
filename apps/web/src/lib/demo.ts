"use client";

import { useEffect, useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken, currentUserId, useAccount } from "./account";
import { useFeatures } from "./features";
import { pushToast } from "./toast";
import type { DemoRule } from "./growth";

/* Demo or real. In demo the whole app (trade panel, portfolio, P&L, sniper) runs on a
   virtual $10,000 account that the gateway fills at live market prices. In real it shows
   the connected wallet. The choice is kept per browser. */

export type Mode = "demo" | "real";

export type DemoPosition = {
  mint: string;
  symbol: string;
  tokens: number;
  cost_usd: number;
  price_usd: number | null;
  value_usd: number | null;
  opened_at: string;
};
export type DemoAccount = { cash_usd: number; start_usd: number; round: number; positions: DemoPosition[]; equity_usd: number };
export type DemoFill = {
  side: "buy" | "sell";
  tokens: number;
  usd: number;
  sol: number;
  price_usd: number;
  market_usd: number;
  fee_usd: number;
  impact_pct: number;
};
export type DemoTrade = {
  id: number;
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  tokens: number;
  usd: number;
  sol: number;
  price_usd: number;
  fee_usd: number;
  impact_pct: number;
  source: "manual" | "sniper" | "tp" | "sl";
  realized_usd: number | null;
  round: number;
  ts: string;
};

/** `owner` is the user the demo data belongs to: it is never shown to anyone else. */
type State = { mode: Mode; owner: string | null; account: DemoAccount | null; trades: DemoTrade[] | null; rules: DemoRule[]; error: string | null };
const KEY = "mx.mode";
let state: State = { mode: "demo", owner: null, account: null, trades: null, rules: [], error: null };
let loaded = false;
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};
const SERVER: State = { mode: "demo", owner: null, account: null, trades: null, rules: [], error: null };

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const m = localStorage.getItem(KEY);
    if (m === "demo" || m === "real") state = { ...state, mode: m };
  } catch {}
}

export function setMode(mode: Mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
  set({ mode });
  if (mode === "demo") refreshDemo();
}

export function useMode(): Mode {
  const on = useFeatures().demo;
  const m = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (load(), state.mode),
    () => SERVER.mode,
  );
  return on ? m : "real";
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = accessToken();
  if (!token) throw new Error("Sign in to use the demo account");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

let inflight: Promise<void> | null = null;
export function refreshDemo() {
  if (inflight) return inflight;
  const uid = currentUserId();
  if (!uid) return Promise.resolve();
  // Another account signed in: drop the previous one's data before loading.
  if (state.owner !== uid) set({ owner: uid, account: null, trades: null, rules: [], error: null });
  inflight = (async () => {
    try {
      const [account, trades, rules] = await Promise.all([
        call<DemoAccount>("/demo/account"),
        call<DemoTrade[]>("/demo/trades?limit=1000"),
        call<DemoRule[]>("/demo/orders").catch(() => state.rules),
      ]);
      // The user may have signed out or switched while this was loading.
      if (currentUserId() !== uid) return;
      announceFills(state.rules, rules);
      set({ account, trades, rules, error: null });
    } catch (e) {
      if (currentUserId() !== uid) return;
      set({ error: e instanceof Error ? e.message : "Demo account unavailable" });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** A toast for each take profit or stop loss that filled since the last refresh. */
function announceFills(before: DemoRule[], after: DemoRule[]) {
  const wasOpen = new Set(before.filter((r) => r.status === "open").map((r) => r.id));
  for (const r of after) {
    if (r.status !== "filled" || !wasOpen.has(r.id)) continue;
    pushToast({
      kind: "exit",
      tone: r.kind === "tp" ? "good" : "bad",
      title: `${r.kind === "tp" ? "Take profit" : "Stop loss"} hit on ${r.symbol || "your coin"}`,
      body: r.note ?? undefined,
      href: `/token/${r.mint}`,
    });
  }
}

/** The demo account, refreshed every 3 seconds while in demo mode, signed in and the tab is
 *  visible, so balances and P&L move like a real account. */
export function useDemo() {
  const s = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (load(), state),
    () => SERVER,
  );
  const account = useAccount();
  const on = useFeatures().demo;
  const signedIn = account.status === "signed-in";
  const uid = signedIn ? (account.me?.id ?? currentUserId()) : null;
  const mode: Mode = on ? s.mode : "real";
  useEffect(() => {
    if (mode !== "demo" || !signedIn) return;
    refreshDemo();
    const t = setInterval(() => document.visibilityState === "visible" && refreshDemo(), 3_000);
    const back = () => document.visibilityState === "visible" && refreshDemo();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
  }, [mode, signedIn, uid]);
  // Demo data exists only behind a sign-in, and only for its own user.
  const mine = uid !== null && s.owner === uid;
  return { ...s, account: mine ? s.account : null, trades: mine ? s.trades : null, rules: mine ? s.rules : [], error: mine ? s.error : null, mode, enabled: on };
}

export type OrderInput = { mint: string; side: "buy" | "sell"; usd?: number; fraction?: number; source?: "manual" | "sniper" };

/** Prices an order without trading. */
export const previewOrder = (o: OrderInput) => call<{ fill: DemoFill; symbol: string }>("/demo/order", { ...o, preview: true });

/** Places a demo order at the live market (filled about a second later, like a real one). */
export async function placeOrder(o: OrderInput) {
  const res = await call<{ fill: DemoFill; symbol: string; cash_usd: number; realized_usd: number | null }>("/demo/order", o);
  refreshDemo();
  return res;
}

export async function resetDemo() {
  await call("/demo/reset", {});
  await refreshDemo();
}

/** Readable message from a gateway error. */
export function orderError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/demo_|does not exist|not set up/i.test(m)) return "Demo trading is being set up, try again soon";
  return m.length > 160 ? "Order failed, try again" : m;
}
