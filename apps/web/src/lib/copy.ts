"use client";

/** Copy trading: follow a Smart Money wallet's buys and sells with your own size and
 *  rules. Copies start on demo and move to real once they have earned it. They run in this
 *  browser while Kixo is open, through the same trade path as everything else. */

import { useSyncExternalStore } from "react";
import { currentUserId } from "./account";
import type { Venue } from "./execute";
import { DEFAULT_RULES, type CopyRules } from "./copy-math";

export * from "./copy-math";

export type CopyEvent = {
  at: number;
  side: "buy" | "sell";
  mint: string;
  symbol: string;
  /** done | skipped | failed */
  result: "done" | "skipped" | "failed";
  note?: string;
  /** Copy cost in % (our price vs the leader's). */
  costPct?: number | null;
  /** Profit of a sell, in the venue's unit. */
  profit?: number;
};

export type Copy = {
  id: string;
  leader: string;
  venue: Venue;
  rules: CopyRules;
  status: "running" | "paused";
  pausedWhy?: string;
  createdAt: number;
  /** Our tokens and their cost per coin bought by this copy. */
  positions: Record<string, { tokens: number; cost: number; symbol: string }>;
  realized: number;
  buys: number;
  sells: number;
  /** Times of copied buys, for the daily limit. */
  buyTimes: number[];
  events: CopyEvent[];
};

const MAX_COPIES = 10;
const MAX_EVENTS = 60;
let copies: Copy[] = [];
let loadedFor: string | null | undefined;
const subs = new Set<() => void>();
const keyFor = (uid: string | null) => `kixo.copies.${uid ?? "anon"}`;

function load() {
  const uid = currentUserId();
  if (loadedFor === uid || typeof window === "undefined") return;
  loadedFor = uid;
  try {
    copies = JSON.parse(localStorage.getItem(keyFor(uid)) ?? "[]") as Copy[];
  } catch {
    copies = [];
  }
}

function save(next: Copy[]) {
  copies = next;
  try {
    localStorage.setItem(keyFor(loadedFor ?? null), JSON.stringify(next));
  } catch {}
  subs.forEach((f) => f());
}

export function getCopies() {
  load();
  return copies;
}

const EMPTY: Copy[] = [];
export function useCopies(): Copy[] {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => (load(), copies),
    () => EMPTY,
  );
}

export function addCopy(leader: string, venue: Venue, rules: Partial<CopyRules>): string | null {
  load();
  if (copies.some((c) => c.leader === leader && c.venue === venue)) return "You already copy this wallet here";
  if (copies.length >= MAX_COPIES) return `At most ${MAX_COPIES} copies`;
  save([
    { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, leader, venue, rules: { ...DEFAULT_RULES, ...rules }, status: "running", createdAt: Date.now(), positions: {}, realized: 0, buys: 0, sells: 0, buyTimes: [], events: [] },
    ...copies,
  ]);
  return null;
}

export function updateCopy(id: string, patch: Partial<Copy> | ((c: Copy) => Partial<Copy>)) {
  load();
  save(copies.map((c) => (c.id === id ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c)));
}

export function logCopy(id: string, e: CopyEvent) {
  updateCopy(id, (c) => ({ events: [e, ...c.events].slice(0, MAX_EVENTS) }));
}

export function removeCopy(id: string) {
  load();
  save(copies.filter((c) => c.id !== id));
}

/** Moves a demo copy to real: a fresh real copy with the same rules (amount in SOL). */
export function promoteCopy(c: Copy, solAmount: number): string | null {
  const err = addCopy(c.leader, "real", { ...c.rules, amount: solAmount });
  if (!err) updateCopy(c.id, { status: "paused", pausedWhy: "Moved to real" });
  return err;
}
