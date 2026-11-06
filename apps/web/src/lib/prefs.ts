"use client";

import { useSyncExternalStore } from "react";

/* Per-browser preferences: the watchlist and Radar alert settings. They stay in this
   browser only (localStorage) and the page works without them, e.g. in a private
   window. Accounts (Supabase) will carry them across devices later. */

function store<T>(key: string, fallback: T) {
  let value: T = fallback;
  let loaded = false;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) value = { ...fallback, ...JSON.parse(raw) };
    } catch {
      // Storage blocked or corrupt: keep the default.
    }
  };
  return {
    get: () => {
      load();
      return value;
    },
    set: (next: T) => {
      value = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not persisted; still applies for this visit.
      }
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    fallback,
  };
}

/* Watchlist: starred coins, newest first. */
type Watch = { mints: string[] };
const watch = store<Watch>("mx.watchlist", { mints: [] });

export function useWatchlist() {
  const w = useSyncExternalStore(watch.subscribe, watch.get, () => watch.fallback);
  return {
    mints: w.mints,
    has: (mint: string) => w.mints.includes(mint),
    toggle: (mint: string) => {
      const cur = watch.get().mints;
      watch.set({ mints: cur.includes(mint) ? cur.filter((m) => m !== mint) : [mint, ...cur].slice(0, 200) });
    },
  };
}

/* Radar alerts. */
export type AlertPrefs = {
  /** A coin passes every lower-risk check. */
  lowerRisk: boolean;
  /** A curve crosses 80% (close to graduating). */
  curve80: boolean;
  /** A starred coin's dev starts selling. */
  devSells: boolean;
  sound: boolean;
  desktop: boolean;
};
const alerts = store<AlertPrefs>("mx.alerts", { lowerRisk: false, curve80: false, devSells: true, sound: true, desktop: false });

export function useAlertPrefs() {
  const prefs = useSyncExternalStore(alerts.subscribe, alerts.get, () => alerts.fallback);
  return { prefs, set: (patch: Partial<AlertPrefs>) => alerts.set({ ...alerts.get(), ...patch }) };
}

/* Radar filters and blacklist. Number fields: null = no limit. */
export type RadarFilters = {
  minMcUsd: number | null;
  maxMcUsd: number | null;
  maxAgeMin: number | null;
  minHolders: number | null;
  maxDevPct: number | null;
  maxTop10Pct: number | null;
  maxBundlePct: number | null;
  socialsOnly: boolean;
  /** Stages to show ("new", "final", "graduated"); empty shows all. */
  stages: string[];
  /** Comma-separated words: show only coins whose name or symbol has one / hide those that do. */
  include: string;
  exclude: string;
  /** Creator wallets whose coins are always hidden. */
  blockedDevs: string[];
};
export const NO_FILTERS: RadarFilters = {
  minMcUsd: null,
  maxMcUsd: null,
  maxAgeMin: null,
  minHolders: null,
  maxDevPct: null,
  maxTop10Pct: null,
  maxBundlePct: null,
  socialsOnly: false,
  stages: [],
  include: "",
  exclude: "",
  blockedDevs: [],
};
const radar = store<RadarFilters>("mx.radar.filters", NO_FILTERS);

export function useRadarFilters() {
  const f = useSyncExternalStore(radar.subscribe, radar.get, () => radar.fallback);
  return {
    filters: f,
    set: (patch: Partial<RadarFilters>) => radar.set({ ...radar.get(), ...patch }),
    /** Clear every filter but keep the blacklist. */
    reset: () => radar.set({ ...NO_FILTERS, blockedDevs: radar.get().blockedDevs }),
    blockDev: (wallet: string) => {
      const cur = radar.get().blockedDevs;
      if (!cur.includes(wallet)) radar.set({ ...radar.get(), blockedDevs: [wallet, ...cur].slice(0, 500) });
    },
    unblockDev: (wallet: string) => radar.set({ ...radar.get(), blockedDevs: radar.get().blockedDevs.filter((w) => w !== wallet) }),
  };
}

/** How many filters (not the blacklist) are set. */
export function activeFilterCount(f: RadarFilters) {
  const n = [f.minMcUsd, f.maxMcUsd, f.maxAgeMin, f.minHolders, f.maxDevPct, f.maxTop10Pct, f.maxBundlePct].filter((v) => v != null).length;
  return n + (f.socialsOnly ? 1 : 0) + (f.stages.length ? 1 : 0) + (f.include.trim() ? 1 : 0) + (f.exclude.trim() ? 1 : 0);
}

/* Price alerts: fire once when a coin's market cap crosses a level, then clear. */
export type PriceAlert = { id: string; mint: string; symbol: string; above: boolean; mcUsd: number; created: number };
type Alerts = { list: PriceAlert[] };
const priceAlerts = store<Alerts>("mx.price-alerts", { list: [] });

export function usePriceAlerts() {
  const a = useSyncExternalStore(priceAlerts.subscribe, priceAlerts.get, () => priceAlerts.fallback);
  return {
    list: a.list,
    add: (x: Omit<PriceAlert, "id" | "created">) =>
      priceAlerts.set({ list: [{ ...x, id: `${x.mint}:${x.above ? "a" : "b"}:${x.mcUsd}`, created: Date.now() }, ...priceAlerts.get().list].slice(0, 100) }),
    remove: (id: string) => priceAlerts.set({ list: priceAlerts.get().list.filter((x) => x.id !== id) }),
  };
}

/* Discover filters. null = no limit. */
export type DiscoverFilters = {
  minMcUsd: number | null;
  maxMcUsd: number | null;
  minLiquidityUsd: number | null;
  minVol1hUsd: number | null;
  minHolders: number | null;
  minAgeHours: number | null;
  maxAgeHours: number | null;
};
export const NO_DISCOVER_FILTERS: DiscoverFilters = {
  minMcUsd: null,
  maxMcUsd: null,
  minLiquidityUsd: null,
  minVol1hUsd: null,
  minHolders: null,
  minAgeHours: null,
  maxAgeHours: null,
};
const discover = store<DiscoverFilters>("mx.discover.filters", NO_DISCOVER_FILTERS);

export function useDiscoverFilters() {
  const f = useSyncExternalStore(discover.subscribe, discover.get, () => discover.fallback);
  return {
    filters: f,
    count: Object.values(f).filter((v) => v != null).length,
    set: (patch: Partial<DiscoverFilters>) => discover.set({ ...discover.get(), ...patch }),
    reset: () => discover.set(NO_DISCOVER_FILTERS),
  };
}

/* Wallet Monitor: wallets the user follows, alert rules, and delivery channels.
   Kept in this browser until accounts (Supabase) exist; then the gateway delivers
   Telegram and Discord alerts even when MONEXA is closed. */
export type MonitoredWallet = {
  address: string;
  label: string;
  /** Alert on buys of at least this many SOL (0 = every buy). */
  minBuySol: number;
  /** Alert on sells too. */
  sells: boolean;
  added: number;
};
export type MonitorPrefs = {
  wallets: MonitoredWallet[];
  /** In-browser notifications while MONEXA is open. */
  browser: boolean;
  discordWebhook: string;
  telegramChatId: string;
};
const monitor = store<MonitorPrefs>("mx.monitor", { wallets: [], browser: true, discordWebhook: "", telegramChatId: "" });
export const MAX_MONITORED = 50;

export function useMonitor() {
  const m = useSyncExternalStore(monitor.subscribe, monitor.get, () => monitor.fallback);
  return {
    prefs: m,
    has: (address: string) => m.wallets.some((w) => w.address === address),
    add: (address: string, label = "") => {
      const cur = monitor.get();
      if (cur.wallets.some((w) => w.address === address) || cur.wallets.length >= MAX_MONITORED) return false;
      monitor.set({ ...cur, wallets: [{ address, label, minBuySol: 1, sells: true, added: Date.now() }, ...cur.wallets] });
      return true;
    },
    update: (address: string, patch: Partial<MonitoredWallet>) =>
      monitor.set({ ...monitor.get(), wallets: monitor.get().wallets.map((w) => (w.address === address ? { ...w, ...patch } : w)) }),
    remove: (address: string) => monitor.set({ ...monitor.get(), wallets: monitor.get().wallets.filter((w) => w.address !== address) }),
    set: (patch: Partial<Omit<MonitorPrefs, "wallets">>) => monitor.set({ ...monitor.get(), ...patch }),
  };
}
