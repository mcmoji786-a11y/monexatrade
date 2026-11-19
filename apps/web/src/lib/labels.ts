"use client";

/** Wallet labels: who a wallet is in a coin (dev, sniper, bundler, whale), from the
 *  gateway's trade book, and Smart Money leaders anywhere on the site. */

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";

export type WalletLabel = "dev" | "sniper" | "bundler" | "whale" | "smart";
export const LABEL_ORDER: WalletLabel[] = ["dev", "smart", "whale", "bundler", "sniper"];

/* ---------------- Smart Money, site-wide ---------------- */

let smart: Set<string> = new Set();
let smartStarted = false;
const smartSubs = new Set<() => void>();

async function loadSmart() {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/smart-money`, { cache: "no-store" });
    if (!r.ok) return;
    const v = (await r.json()) as { leaders?: { wallet: string }[] };
    smart = new Set((v.leaders ?? []).map((l) => l.wallet));
    smartSubs.forEach((f) => f());
  } catch {}
}

const EMPTY_SET: Set<string> = new Set();

/** Smart Money leaders' wallets, refreshed every 5 minutes. */
export function useSmartWallets(): Set<string> {
  return useSyncExternalStore(
    (f) => {
      smartSubs.add(f);
      if (!smartStarted) {
        smartStarted = true;
        void loadSmart();
        setInterval(() => void loadSmart(), 5 * 60_000);
      }
      return () => smartSubs.delete(f);
    },
    () => smart,
    () => EMPTY_SET,
  );
}

/* ---------------- One coin's labels ---------------- */

export type CoinLabels = Record<string, WalletLabel[]>;

/** The labelled wallets of one coin, refreshed every 10 seconds while shown. */
export function useCoinLabels(mint: string | null): CoinLabels {
  const [state, setState] = useState<{ mint: string; labels: CoinLabels } | null>(null);
  useEffect(() => {
    if (!mint) return;
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`${GATEWAY_HTTP}/token/${mint}/labels`, { cache: "no-store" });
        if (!r.ok) return;
        const v = (await r.json()) as { labels?: CoinLabels };
        if (live) setState({ mint, labels: v.labels ?? {} });
      } catch {}
    };
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [mint]);
  return state && state.mint === mint ? state.labels : {};
}

/** The coin labels in scope (set by the trade page around its lists). */
export const CoinLabelsContext = createContext<CoinLabels | null>(null);

/** Every label a wallet has here: the coin's labels in scope, Smart Money, and any the
 *  caller already knows (e.g. a trade row's dev or sniper flag). Sorted, no repeats. */
export function useWalletLabels(wallet: string, extra: (WalletLabel | false | undefined)[] = []): WalletLabel[] {
  const coin = useContext(CoinLabelsContext);
  const smartSet = useSmartWallets();
  const all = new Set<WalletLabel>(coin?.[wallet] ?? []);
  if (smartSet.has(wallet)) all.add("smart");
  for (const l of extra) if (l) all.add(l);
  return LABEL_ORDER.filter((l) => all.has(l));
}

/* ---------------- One coin's bundles and clusters ---------------- */

/** A bundle (wallets that bought in the same block at launch) or a cluster (wallets whose
 *  first SOL came from the same wallet), from the gateway (funders.rs). */
export type CoinGroup = { id: string; size: number; hold_pct: number; still_holding: number; wallets: string[]; funder?: string; dev?: boolean; slot?: number };
export type CoinGroups = { bundles: CoinGroup[]; clusters: CoinGroup[]; scanning?: boolean; checked?: number; of?: number };
export type WalletGroups = { bundle?: CoinGroup; cluster?: CoinGroup };

const NO_GROUPS: CoinGroups = { bundles: [], clusters: [] };

/** A coin's bundles and clusters, refreshed every 15 seconds while shown (the funder
 *  lookups finish in the background, so clusters fill in over the first minute). */
export function useCoinGroups(mint: string | null): CoinGroups {
  const [state, setState] = useState<{ mint: string; groups: CoinGroups } | null>(null);
  useEffect(() => {
    if (!mint) return;
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`${GATEWAY_HTTP}/token/${mint}/groups`, { cache: "no-store" });
        if (!r.ok) return;
        const v = (await r.json()) as CoinGroups;
        if (live) setState({ mint, groups: { ...NO_GROUPS, ...v } });
      } catch {}
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [mint]);
  return state && state.mint === mint ? state.groups : NO_GROUPS;
}

/** Wallet -> its bundle and cluster, for quick lookups in long lists. */
export function groupIndex(g: CoinGroups): Map<string, WalletGroups> {
  const m = new Map<string, WalletGroups>();
  for (const b of g.bundles) for (const w of b.wallets) m.set(w, { ...m.get(w), bundle: b });
  for (const c of g.clusters) for (const w of c.wallets) m.set(w, { ...m.get(w), cluster: c });
  return m;
}

/** The coin groups in scope (set by the trade page around its lists). */
export const CoinGroupsContext = createContext<Map<string, WalletGroups> | null>(null);

export function useWalletGroups(wallet: string): WalletGroups {
  return useContext(CoinGroupsContext)?.get(wallet) ?? {};
}
