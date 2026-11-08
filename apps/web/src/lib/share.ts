"use client";

/** Opens a share card from anywhere: a closed trade, a coin, a position's milestone or
 *  the weekly recap. One card at a time, drawn by ShareCardHost. */

import { useSyncExternalStore } from "react";
import type { DemoTrade } from "./demo";
import type { Recap } from "./achievements";

export type ShareTrade = DemoTrade & { openedAt: string | null };

/** A coin as Kixo saw it. `firstMcUsd` is set only when Kixo watched it from launch. */
export type CoinShare = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  mcUsd: number | null;
  firstMcUsd: number | null;
  /** When Kixo first saw it (unix seconds). */
  firstSeen: number | null;
  safety: number | null;
  holders: number | null;
  top10Pct: number | null;
  liquidityUsd: number | null;
  ageSecs: number | null;
};

/** An open demo position that reached a multiple of its cost. */
export type Milestone = { mint: string; symbol: string; multiple: number; costUsd: number; valueUsd: number; entryPrice: number | null; price: number | null; openedAt: string };

export type ShareSpec = { kind: "trade"; trade: ShareTrade } | { kind: "coin"; coin: CoinShare } | { kind: "milestone"; m: Milestone } | { kind: "recap"; recap: Recap };

let current: ShareSpec | null = null;
const subs = new Set<() => void>();

export function openShare(s: ShareSpec) {
  current = s;
  subs.forEach((f) => f());
}

export const openShareCard = (t: ShareTrade) => openShare({ kind: "trade", trade: t });

export function closeShareCard() {
  current = null;
  subs.forEach((f) => f());
}

export function useShareCard(): ShareSpec | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => null,
  );
}
