"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  Bot,
  Compass,
  ScanSearch,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  AutomateVisual,
  CommunityVisual,
  DiscoverVisual,
  IntelligenceVisual,
  TrackVisual,
  TradeVisual,
} from "./visuals";
import { RadarPanel } from "./radar-panel";

export type FeatureStatus = "live" | "building" | "planned";

type Category = {
  key: string;
  label: string;
  icon: LucideIcon;
  title: string;
  body: string;
  features: { name: string; status: FeatureStatus }[];
  Visual: React.ComponentType;
};

/** Every module from MONEXA_MASTER_SPEC.md V3, grouped the way a trader uses them.
 *  Status: live = working today, building = V1 roadmap, planned = product phase 2. */
const CATEGORIES: Category[] = [
  {
    key: "discover",
    label: "Discover",
    icon: Compass,
    title: "Find tokens the moment they exist",
    body: "Sol Radar streams new launches from the chain. Each token gets its own page with charts, holders and contract permissions.",
    features: [
      { name: "Sol Radar live launches", status: "live" },
      { name: "Price, market cap, volume, holders", status: "live" },
      { name: "Filters, sorting and contract search", status: "live" },
      { name: "Trending, gainers, migrated and whale views", status: "building" },
      { name: "Token pages with candles and holder analytics", status: "building" },
      { name: "Mint, freeze and liquidity checks", status: "building" },
      { name: "Watchlists and saved filters", status: "building" },
    ],
    Visual: DiscoverPanels,
  },
  {
    key: "trade",
    label: "Trade",
    icon: ArrowLeftRight,
    title: "Fast trades from your own wallet",
    body: "Build the order, see the fee and a simulation, then sign in Phantom. Kixo never holds your keys.",
    features: [
      { name: "Instant and one-click buy and sell", status: "building" },
      { name: "Presets, custom amounts and multiple wallets", status: "building" },
      { name: "Limit orders and DCA", status: "building" },
      { name: "Take profit, stop loss and trailing stop", status: "building" },
      { name: "Slippage, priority fee and MEV protection", status: "building" },
      { name: "Simulation before every signature", status: "building" },
      { name: "Failed trade diagnosis and safe retry", status: "building" },
    ],
    Visual: TradeVisual,
  },
  {
    key: "automate",
    label: "Automate",
    icon: Bot,
    title: "Snipers and copy trading under your limits",
    body: "Bots react to launches, liquidity, migrations and tracked wallets. Your limits always win over any automated decision.",
    features: [
      { name: "New pair, liquidity and migration snipers", status: "planned" },
      { name: "Price and volume triggers", status: "planned" },
      { name: "Smart wallet discovery and quality score", status: "planned" },
      { name: "Copy trading with per-wallet allocation", status: "planned" },
      { name: "Copy or skip decisions with reasons", status: "planned" },
      { name: "Daily loss limits and emergency stop", status: "planned" },
      { name: "Backtesting and paper trading", status: "planned" },
    ],
    Visual: AutomateVisual,
  },
  {
    key: "intelligence",
    label: "Intelligence",
    icon: ScanSearch,
    title: "Research that separates facts from guesses",
    body: "Research agents read on-chain activity, news and social signals, and label every finding as verified or estimated.",
    features: [
      { name: "Token and wallet research agents", status: "planned" },
      { name: "Holder, whale and manipulation analysis", status: "planned" },
      { name: "Market and news summaries", status: "planned" },
      { name: "Risk scores with explanations", status: "planned" },
      { name: "Search-based research assistant", status: "planned" },
    ],
    Visual: IntelligenceVisual,
  },
  {
    key: "track",
    label: "Track",
    icon: Wallet,
    title: "Wallets, portfolio and alerts in one place",
    body: "Follow any public wallet, see your own results across wallets and get alerted when something you care about moves.",
    features: [
      { name: "Track any public Solana wallet", status: "building" },
      { name: "Wallet P/L, win rate and holding time", status: "building" },
      { name: "Portfolio value, allocation and P/L", status: "building" },
      { name: "Price, launch, whale and trade alerts", status: "building" },
      { name: "Solana and token news", status: "building" },
    ],
    Visual: TrackVisual,
  },
  {
    key: "community",
    label: "Rewards",
    icon: Trophy,
    title: "Rewards, rankings and real support",
    body: "Earn from referrals, compare results on weekly leaderboards and reach a person when a transaction goes wrong.",
    features: [
      { name: "Referral links and rewards", status: "building" },
      { name: "Weekly and monthly leaderboards", status: "building" },
      { name: "Support chat and tickets", status: "building" },
      { name: "In-app bug reporting", status: "building" },
    ],
    Visual: CommunityVisual,
  },
];

/** Live radar feed on top, token page preview below. */
function DiscoverPanels() {
  return (
    <div className="space-y-4">
      <RadarPanel />
      <DiscoverVisual />
    </div>
  );
}

export function FeatureExplorer() {
  const [active, setActive] = useState(0);
  const cat = CATEGORIES[active];

  return (
    <div className="mt-12">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-1 border-b border-border" role="tablist" aria-label="Feature groups">
          {CATEGORIES.map((c, i) => {
            const Icon = c.icon;
            const on = i === active;
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(i)}
                className={`relative flex h-11 items-center gap-2 px-4 text-sm transition-colors duration-150 ${
                  on ? "text-text" : "text-text-2 hover:text-text"
                }`}
              >
                <Icon size={16} strokeWidth={1.5} className={on ? "text-emerald" : "text-muted"} />
                {c.label}
                {on && <span className="absolute inset-x-3 -bottom-px h-px bg-emerald" />}
              </button>
            );
          })}
        </div>
      </div>

      <div key={cat.key} role="tabpanel" className="fade-up mt-10 grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
        <div>
          <h3 className="text-2xl font-medium text-text">{cat.title}</h3>
          <p className="mt-3 max-w-lg leading-7 text-text-2">{cat.body}</p>
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {cat.features.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm text-text">{f.name}</span>
                <StatusTag status={f.status} />
              </li>
            ))}
          </ul>
        </div>
        <cat.Visual />
      </div>
    </div>
  );
}

export function StatusTag({ status }: { status: FeatureStatus }) {
  if (status === "live")
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-emerald">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
        Live
      </span>
    );
  return (
    <span className="shrink-0 font-mono text-xs text-muted">{status === "building" ? "In development" : "Planned"}</span>
  );
}

export const FEATURE_COUNTS = (() => {
  const all = CATEGORIES.flatMap((c) => c.features);
  return {
    total: all.length,
    live: all.filter((f) => f.status === "live").length,
    building: all.filter((f) => f.status === "building").length,
    planned: all.filter((f) => f.status === "planned").length,
  };
})();
