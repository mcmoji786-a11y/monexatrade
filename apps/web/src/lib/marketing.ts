"use client";

/**
 * Marketing set in the admin: tracking links (`?c=CODE`), the scheduled banner and
 * popup, the social links, and promo codes that lower a user's fees.
 */

import { useEffect, useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken, useAccount } from "./account";

export type Message = { on: boolean; id: string; title: string; text: string; link: string; link_label: string; starts: number; ends: number; audience: "all" | "signed_out" | "signed_in" | "" };
export type Site = { x: string; telegram: string; discord: string; youtube: string; seo_title: string; seo_description: string };
export type MarketingPublic = { banner: Message | null; popup: Message | null; site: Site };

const EMPTY: MarketingPublic = { banner: null, popup: null, site: { x: "", telegram: "", discord: "", youtube: "", seo_title: "", seo_description: "" } };
let state = EMPTY;
let started = false;
const subs = new Set<() => void>();

async function load() {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/marketing`, { cache: "no-store" });
    if (r.ok) {
      state = { ...EMPTY, ...((await r.json()) as MarketingPublic) };
      subs.forEach((f) => f());
    }
  } catch {}
}

/** The banner and popup live now, and the social links; refreshed every 5 minutes. */
export function useMarketing(): MarketingPublic {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!started) {
        started = true;
        void load();
        setInterval(() => void load(), 5 * 60_000);
      }
      return () => subs.delete(f);
    },
    () => state,
    () => EMPTY,
  );
}

/** Whether a message is meant for this visitor. */
export function forAudience(m: Message, signedIn: boolean) {
  return !m.audience || m.audience === "all" || (m.audience === "signed_in") === signedIn;
}

/* ---------------- Tracking links ---------------- */

const CAMPAIGN_KEY = "kixo.campaign";
const CAMPAIGN_TTL = 30 * 24 * 3600 * 1000;

/** Remembers `?c=CODE`, reports the visit, and reports the sign-up once signed in. */
export function useCampaignCapture() {
  const account = useAccount();
  useEffect(() => {
    try {
      const c = new URLSearchParams(window.location.search).get("c")?.trim().toLowerCase();
      if (c && /^[a-z0-9_-]{3,20}$/.test(c)) {
        localStorage.setItem(CAMPAIGN_KEY, JSON.stringify({ c, at: Date.now() }));
        void fetch(`${GATEWAY_HTTP}/track/visit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c }) }).catch(() => {});
      }
    } catch {}
  }, []);
  const ready = account.status === "signed-in";
  useEffect(() => {
    if (!ready) return;
    let saved: { c: string; at: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) ?? "null");
    } catch {}
    if (!saved) return;
    const drop = () => {
      try {
        localStorage.removeItem(CAMPAIGN_KEY);
      } catch {}
    };
    if (Date.now() - saved.at > CAMPAIGN_TTL) return drop();
    const token = accessToken();
    if (!token) return;
    // The gateway keeps the first campaign per account, so one attempt is enough.
    fetch(`${GATEWAY_HTTP}/track/signup`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ c: saved.c }) }).then(drop, drop);
  }, [ready]);
}

/* ---------------- Promo codes ---------------- */

export type PromoState = { promo: { code: string; applies: string; discount_pct: number; until: number } | null; trade_fee_bps: number; deposit_fee_bps: number; withdraw_fee_bps: number };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = accessToken();
  if (!token) throw new Error("Sign in first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const v = await res.json().catch(() => null);
  if (!res.ok) throw new Error((v as { message?: string } | null)?.message ?? `Failed (${res.status})`);
  return v as T;
}

export const getPromo = () => call<PromoState>("/promo");
export const redeemPromo = (code: string) => call<PromoState>("/promo/redeem", { code });
