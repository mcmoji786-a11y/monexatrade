"use client";

import { useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";

/* Feature switches set in the admin (gateway admin.rs FeatureFlags). Every user-facing
   feature reads its flag here; a new feature adds one. Everything stays on while the
   gateway cannot be reached, so an outage never hides the product. */

export type Features = {
  maintenance: boolean;
  maintenance_message: string;
  announcement_on: boolean;
  announcement: string;
  discover: boolean;
  radar: boolean;
  trade_page: boolean;
  sniper: boolean;
  smart_money: boolean;
  wallet_monitor: boolean;
  price_alerts: boolean;
  ai_analysis: boolean;
  rewards: boolean;
  safety_score: boolean;
};

export const ALL_ON: Features = {
  maintenance: false,
  maintenance_message: "",
  announcement_on: false,
  announcement: "",
  discover: true,
  radar: true,
  trade_page: true,
  sniper: true,
  smart_money: true,
  wallet_monitor: true,
  price_alerts: true,
  ai_analysis: true,
  rewards: true,
  safety_score: true,
};

/** Admin labels for every switch, in the order the admin shows them. */
export const FEATURE_LIST: { key: keyof Features; label: string; hint: string }[] = [
  { key: "discover", label: "Discover", hint: "Rankings of Solana memecoins" },
  { key: "radar", label: "Sol Radar", hint: "New launches as they happen" },
  { key: "trade_page", label: "Trade page", hint: "Chart, trades and holders of a coin" },
  { key: "safety_score", label: "Safety score", hint: "The 0-100 score on every coin" },
  { key: "ai_analysis", label: "AI analysis", hint: "The AI button on coins" },
  { key: "price_alerts", label: "Price alerts", hint: "Market-cap alerts on the trade page" },
  { key: "sniper", label: "Sniper", hint: "Paper sniper and its page" },
  { key: "smart_money", label: "Smart Money", hint: "Leaderboard of profitable wallets" },
  { key: "wallet_monitor", label: "Wallet Monitor", hint: "Follow wallets and get alerts" },
  { key: "rewards", label: "Rewards", hint: "Referral, cashback and creator programme" },
];

const REFRESH_MS = 60_000;
let state: Features = ALL_ON;
let started = false;
const listeners = new Set<() => void>();

async function load() {
  try {
    const res = await fetch(`${GATEWAY_HTTP}/features`, { cache: "no-store" });
    if (res.ok) {
      state = { ...ALL_ON, ...(await res.json()) };
      listeners.forEach((l) => l());
    }
  } catch {
    // Gateway unreachable: keep the last known switches.
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!started && typeof window !== "undefined") {
    started = true;
    load();
    setInterval(load, REFRESH_MS);
  }
  return () => listeners.delete(l);
}

export function useFeatures(): Features {
  return useSyncExternalStore(subscribe, () => state, () => ALL_ON);
}

/** Which switch a page belongs to, by its first path segment. */
export const PAGE_FLAG: Record<string, keyof Features> = {
  discover: "discover",
  radar: "radar",
  token: "trade_page",
  sniper: "sniper",
  "smart-money": "smart_money",
  wallets: "wallet_monitor",
  rewards: "rewards",
};
