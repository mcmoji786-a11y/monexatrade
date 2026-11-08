"use client";

/** Opens the trade share card from anywhere (a sell notification, the portfolio). */

import { useSyncExternalStore } from "react";
import type { DemoTrade } from "./demo";

export type ShareTrade = DemoTrade & { openedAt: string | null };

let current: ShareTrade | null = null;
const subs = new Set<() => void>();

export function openShareCard(t: ShareTrade) {
  current = t;
  subs.forEach((f) => f());
}

export function closeShareCard() {
  current = null;
  subs.forEach((f) => f());
}

export function useShareCard(): ShareTrade | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
    () => null,
  );
}
