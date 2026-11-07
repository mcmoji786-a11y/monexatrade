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
  accounts: boolean;
  portfolio: boolean;
  demo: boolean;
  share_cards: boolean;
  demo_orders: boolean;
  competition: boolean;
  referrals: boolean;
  real_trading: boolean;
  /** Public address that receives the platform fee. */
  fee_wallet: string;
  settings: boolean;
  support: boolean;
  live_chat: boolean;
  news: boolean;
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
  accounts: true,
  portfolio: true,
  demo: true,
  share_cards: true,
  demo_orders: true,
  competition: true,
  referrals: true,
  // Real money stays off unless the gateway says otherwise.
  real_trading: false,
  fee_wallet: "",
  settings: true,
  support: true,
  live_chat: true,
  news: true,
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
  { key: "portfolio", label: "Portfolio", hint: "Wallet holdings, allocation and P&L" },
  { key: "demo", label: "Demo account", hint: "Virtual $10,000 traded at live prices" },
  { key: "share_cards", label: "Share P&L cards", hint: "Trade result image to share on X, Reddit and Telegram" },
  { key: "demo_orders", label: "Take profit / Stop loss", hint: "Automatic exits on demo positions" },
  { key: "competition", label: "Weekly competition", hint: "Demo trading leaderboard and badges" },
  { key: "referrals", label: "Referral links", hint: "Personal invite links and share-card links" },
  { key: "settings", label: "Settings", hint: "Trading defaults, notifications, data export and account deletion" },
  { key: "support", label: "Support", hint: "Transaction Doctor, help center and tickets" },
  { key: "news", label: "News", hint: "Live Solana and memecoin news panel, from news sites, Reddit, X and Kixo on-chain events" },
  { key: "live_chat", label: "Live chat", hint: "Chat button on every page; online only while an agent is active in the inbox" },
  { key: "real_trading", label: "Real trading", hint: "Real SOL trades signed in Phantom. Turn on only after the security review" },
  { key: "accounts", label: "Accounts", hint: "Sign in with Google, Phantom or email" },
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
  portfolio: "portfolio",
  competition: "competition",
  settings: "settings",
  support: "support",
  news: "news",
};
