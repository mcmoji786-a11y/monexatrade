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
  kixo_sender: boolean;
  wallet_tracker: boolean;
  auto_wallet: boolean;
  ai_risk: boolean;
  ai_chat: boolean;
  social: boolean;
  tour: boolean;
  dev_record: boolean;
  danger_warning: boolean;
  loss_limit: boolean;
  notes: boolean;
  chart_marks: boolean;
  sniper_backtest: boolean;
  db_cleanup: boolean;
  kol_tracker: boolean;
  x_tracker: boolean;
  dev_api: boolean;
  strategy_library: boolean;
  alert_delivery: boolean;
  helius_saver: boolean;
  voice_agent: boolean;
  weekly_recap: boolean;
  pnl_calendar: boolean;
  rug_exit: boolean;
  ai_autotrade: boolean;
  card_deposits: boolean;
  achievements: boolean;
  milestone_alerts: boolean;
  coin_share: boolean;
  onchain_top: boolean;
  copy_trading: boolean;
  grid_trading: boolean;
  quick_buy: boolean;
  wallet_labels: boolean;
  kixo_wallet: boolean;
  wallet_deposits: boolean;
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
  kixo_sender: true,
  wallet_tracker: true,
  auto_wallet: true,
  ai_risk: true,
  ai_chat: true,
  social: true,
  tour: true,
  dev_record: true,
  danger_warning: true,
  loss_limit: true,
  notes: true,
  chart_marks: true,
  sniper_backtest: true,
  db_cleanup: true,
  kol_tracker: true,
  x_tracker: true,
  dev_api: true,
  strategy_library: true,
  alert_delivery: true,
  helius_saver: false,
  voice_agent: true,
  weekly_recap: true,
  pnl_calendar: true,
  rug_exit: true,
  ai_autotrade: false,
  card_deposits: true,
  achievements: true,
  milestone_alerts: true,
  coin_share: true,
  onchain_top: true,
  copy_trading: true,
  grid_trading: true,
  quick_buy: true,
  wallet_labels: true,
  kixo_wallet: true,
  wallet_deposits: true,
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
  { key: "wallet_tracker", label: "Wallet Tracker", hint: "Any wallet's balance, coins and recent swaps, as a page and as a side panel from every wallet address" },
  { key: "wallet_labels", label: "Wallet labels", hint: "Dev, Smart, Whale, Bundler and Sniper tags on wallet addresses, and the Show filter on the trade page" },
  { key: "quick_buy", label: "Quick Buy", hint: "One-click buy button on Discover and Sol Radar rows (demo and real)" },
  { key: "grid_trading", label: "Grid trading", hint: "Grid bots on the trade page: buy each dip to a level, sell one level up (demo and real, while Kixo is open)" },
  { key: "copy_trading", label: "Copy trading", hint: "Copy a Smart Money wallet's buys and sells: starts on demo, moves to real once profitable (runs while Kixo is open)" },
  { key: "onchain_top", label: "On-chain top traders", hint: "Competition page: Solana memecoin traders ranked by on-chain profit, while Kixo has few demo traders" },
  { key: "coin_share", label: "Coin share card", hint: "Share button on the trade page: a coin card with its safety score, and how far it rose since Kixo spotted it at launch" },
  { key: "milestone_alerts", label: "2x, 5x, 10x alerts", hint: "An alert with a share card when an open demo position reaches 2x, 5x, 10x and more" },
  { key: "achievements", label: "Achievements and streaks", hint: "Badges and day and win streaks on the Portfolio page, with an alert when one is earned" },
  { key: "weekly_recap", label: "Weekly recap card", hint: "This week and last week on the Portfolio page, shareable as a card" },
  { key: "card_deposits", label: "Deposit with a card", hint: "Users buy SOL with a card through Changelly, straight into their own Kixo wallet. Needs CHANGELLY_MERCHANT_ID (Admin, API keys)" },
  { key: "ai_autotrade", label: "Kixo AI auto trade", hint: "Copy Kixo AI: the AI buys and sells on its own. Off shows Coming soon (the AI is still being trained) on the AI page, and hides its sniper preset" },
  { key: "rug_exit", label: "Rug exit", hint: "Users can have a demo position sold by itself when the coin's dev sells or Kixo AI calls it Danger (Settings, Safety). Runs on the gateway around the clock. Needs migration 0018 to show as Rug exit in history" },
  { key: "pnl_calendar", label: "Profit calendar", hint: "Portfolio page: profit or loss taken on each day of the month, with winning and losing days" },
  { key: "alert_delivery", label: "Alerts by Email, Telegram, Discord", hint: "Price alerts, Wallet Monitor trades and dev sells on starred coins reach users when Kixo is closed. Telegram needs TELEGRAM_BOT_TOKEN, email needs RESEND_API_KEY (Admin, Keys)" },
  { key: "voice_agent", label: "Kixo Agent (voice)", hint: "The voice guide on coin pages: a spoken read when a coin opens, emergency alerts and push-to-talk questions, all in English. Runs on Kixo's own voice service (ai/voice.py), no outside API" },
  { key: "helius_saver", label: "Helius saver", hint: "Saves Helius credits: when nobody has been on the site for 3 minutes, new launches, trades and live data run on the backup nodes (a little slower). The first visitor brings Helius back within seconds. Trading always uses Helius, and wallet alerts keep running" },
  { key: "dev_record", label: "Creator record", hint: "Trade page: the creator's earlier coins in plain words (launched, rugged, died fast, graduated)" },
  { key: "danger_warning", label: "Danger warning", hint: "A warning toast when a user buys a coin Kixo AI calls Danger. The buy goes out at once, never held up. Users can turn it off for themselves" },
  { key: "loss_limit", label: "Daily loss limit", hint: "Users set a daily loss; after it, buying stops until their midnight (selling always works). Off here: no limit is enforced" },
  { key: "notes", label: "Notes", hint: "Users' own private notes on coins and wallets, saved to their account (migration 0016)" },
  { key: "chart_marks", label: "Chart marks", hint: "Trade page chart: small marks where the creator and smart wallets bought or sold" },
  { key: "x_tracker", label: "X Tracker", hint: "Users pick X accounts; a post with a Solana contract address shows on the page and alerts them. Reading X needs X_BEARER_TOKEN on a paid X API plan (at most 40 accounts read)" },
  { key: "strategy_library", label: "Strategy Library", hint: "Strategies from YouTube, GitHub and X turned into sniper rules (Admin, Strategies), tested on real launches daily; users see published ones on the Sniper page" },
  { key: "dev_api", label: "Kixo AI API", hint: "Developer API keys (Settings) and /v1 endpoints: AI scores, recent scores, KOL coins. 60 calls a minute, 10,000 a day per key" },
  { key: "kol_tracker", label: "KOL Tracker", hint: "Well-known traders' wallets (Admin, KOLs), their live trades, and a KOL badge on coins they bought" },
  { key: "db_cleanup", label: "Database clean-up", hint: "Every 6 hours, demo trades made by the sniper, copy trading and grids older than 60 days are deleted (DEMO_AUTO_KEEP_DAYS), so the free database does not fill up. Manual trades, balances and real trades stay" },
  { key: "sniper_backtest", label: "Sniper test on yesterday", hint: "Sniper page: run your rules on the last 24 hours of real launches and see what would have happened" },
  { key: "tour", label: "Welcome tour", hint: "A one-minute guided tour of the platform for new users, step by step on the real screen. Users can replay it from Settings" },
  { key: "social", label: "Community", hint: "Trader profiles, following traders, the live trade feed, the leaderboard and one-tap copying of Kixo traders (demo trades only)" },
  { key: "ai_chat", label: "Ask Kixo AI: language model", hint: "The AI page's chat answers with a free language model (Gemini, Groq, OpenRouter keys in .env), kept to Solana and crypto. Off: built-in answers from Kixo's data only" },
  { key: "ai_risk", label: "Kixo AI risk", hint: "Sol Radar and the trade page: the trained model's chance a new coin dumps 70%+ or doubles within an hour, judged from its first 2 minutes. Needs the AI service (ai/serve.py)" },
  { key: "auto_wallet", label: "Auto-trade wallet (24/7)", hint: "A second wallet whose key Kixo holds, so orders, grids, copies, the sniper and the AI agent trade 24/7. Its money can only go back to the user's main Kixo wallet" },
  { key: "wallet_monitor", label: "Wallet Monitor", hint: "Follow wallets and get alerts" },
  { key: "rewards", label: "Rewards", hint: "Referral, cashback and creator programme" },
  { key: "portfolio", label: "Portfolio", hint: "Wallet holdings, allocation and P&L" },
  { key: "demo", label: "Demo account", hint: "Virtual $10,000 traded at live prices" },
  { key: "share_cards", label: "Share P&L cards", hint: "Trade result image to share on X, Reddit and Telegram" },
  { key: "demo_orders", label: "Orders", hint: "Limit buy and sell, stop loss and trailing stop on the trade page: demo watched by the gateway around the clock, real while Kixo is open" },
  { key: "competition", label: "Weekly competition", hint: "Demo trading leaderboard and badges" },
  { key: "referrals", label: "Referral links", hint: "Personal invite links and share-card links" },
  { key: "settings", label: "Settings", hint: "Trading defaults, notifications, data export and account deletion" },
  { key: "support", label: "Support", hint: "Transaction Doctor, help center and tickets" },
  { key: "news", label: "News", hint: "Live Solana and memecoin news panel, from news sites, Reddit, X and Kixo on-chain events" },
  { key: "live_chat", label: "Live chat", hint: "Chat button on every page; online only while an agent is active in the inbox" },
  { key: "kixo_wallet", label: "Kixo wallet", hint: "Trading wallet made and locked in the user's browser with their wallet password; Kixo stores only the locked copy" },
  { key: "wallet_deposits", label: "Wallet deposits", hint: "Real SOL deposits into Kixo wallets, from Phantom or an exchange. Withdrawals always stay open" },
  { key: "kixo_sender", label: "Kixo Sender", hint: "Real trades also go straight to the next Solana leaders over QUIC, next to Helius Sender, Jito and the RPC" },
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

/** The switches outside React (event handlers). */
export function featuresNow(): Features {
  return state;
}

export function useFeatures(): Features {
  return useSyncExternalStore(subscribe, () => state, () => ALL_ON);
}

/** Which switch a page belongs to, by its first path segment. */
export const PAGE_FLAG: Record<string, keyof Features> = {
  discover: "discover",
  radar: "radar",
  ai: "ai_risk",
  community: "social",
  u: "social",
  token: "trade_page",
  sniper: "sniper",
  "smart-money": "smart_money",
  tracker: "wallet_tracker",
  rewards: "rewards",
  portfolio: "portfolio",
  competition: "competition",
  settings: "settings",
  support: "support",
  news: "news",
};
