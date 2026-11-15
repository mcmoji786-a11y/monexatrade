"use client";
/* KOL Tracker (gateway kols.rs): well-known traders named with their X accounts, which
   coins they bought in the last 24 hours, and their trades live. */
import { useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";

export type Kol = { address: string; name: string; x: string; buys_24h: number; sells_24h: number; last_trade: number | null };
export type KolName = { name: string; x: string };

let coins: Record<string, KolName[]> = {};
let started = false;
const listeners = new Set<() => void>();

async function loadCoins() {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/kols/coins`, { cache: "no-store" });
    if (!r.ok) return;
    coins = ((await r.json()) as { coins: Record<string, KolName[]> }).coins ?? {};
    listeners.forEach((l) => l());
  } catch {}
}

const EMPTY: KolName[] = [];

/** The KOLs who bought this coin in the last 24 hours (shared, refreshed every 20 s). */
export function useCoinKols(mint: string): KolName[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!started && typeof window !== "undefined") {
        started = true;
        void loadCoins();
        setInterval(() => document.visibilityState === "visible" && void loadCoins(), 20_000);
      }
      return () => listeners.delete(l);
    },
    () => coins[mint] ?? EMPTY,
    () => EMPTY,
  );
}

export async function getKols(): Promise<Kol[]> {
  const r = await fetch(`${GATEWAY_HTTP}/kols`, { cache: "no-store" });
  const text = await r.text();
  if (!r.ok) throw new Error(text || "Could not load");
  return (JSON.parse(text) as { kols: Kol[] }).kols;
}

export const xUrl = (h: string) => `https://x.com/${h}`;
