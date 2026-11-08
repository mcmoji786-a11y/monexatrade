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
