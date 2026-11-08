"use client";

/** Grid trading: a price range split into levels. Each slot buys when the price falls to
 *  its lower level and sells those tokens when the price rises to the next level, again
 *  and again, so a coin that moves sideways pays out on every swing.
 *
 *  Grids run in this browser while Kixo is open, on demo and real alike, through the same
 *  trade path (lib/execute) and the same live price as orders (gateway /price). No
 *  market buy at the start: only levels below the current price are armed; the ones above
 *  arm once the price has passed them, so they buy on the way back down. */

import { useSyncExternalStore } from "react";
import { currentUserId } from "./account";
import type { Venue } from "./execute";

export type { Slot } from "./grid-math";
import { makeSlots, type Slot } from "./grid-math";
export { MIN_LEVELS, MAX_LEVELS, levels, stepPct, checkGrid, makeSlots, gridStep } from "./grid-math";

export type Grid = {
  id: string;
  mint: string;
  symbol: string;
  venue: Venue;
  lower: number;
  upper: number;
  /** Per slot: USD on demo, SOL on real. */
  amount: number;
  slots: Slot[];
  status: "running" | "stopped";
  createdAt: number;
  /** Realized profit, in the venue's unit (USD demo, SOL real), after fees. */
  realized: number;
  buys: number;
  sells: number;
  note?: string;
  busy?: boolean;
};

const MAX_GRIDS = 10;

/* ---------------- Storage (this browser, per account) ---------------- */

let grids: Grid[] = [];
let loadedFor: string | null | undefined;
const subs = new Set<() => void>();
const keyFor = (uid: string | null) => `kixo.grids.${uid ?? "anon"}`;

function load() {
  const uid = currentUserId();
  if (loadedFor === uid || typeof window === "undefined") return;
  loadedFor = uid;
  try {
    grids = (JSON.parse(localStorage.getItem(keyFor(uid)) ?? "[]") as Grid[]).map((g) => ({ ...g, busy: false }));
  } catch {
    grids = [];
  }
}

function save(next: Grid[]) {
  grids = next;
  try {
    localStorage.setItem(keyFor(loadedFor ?? null), JSON.stringify(next));
  } catch {}
  subs.forEach((f) => f());
}

export function getGrids() {
  load();
  return grids;
}

const EMPTY: Grid[] = [];
export function useGrids(): Grid[] {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => (load(), grids),
    () => EMPTY,
  );
}

export function addGrid(g: Omit<Grid, "id" | "slots" | "status" | "createdAt" | "realized" | "buys" | "sells">, count: number, price: number): string | null {
  load();
  if (grids.filter((x) => x.status === "running").length >= MAX_GRIDS) return `At most ${MAX_GRIDS} running grids`;
  save([{ ...g, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, slots: makeSlots(g.lower, g.upper, count, price), status: "running", createdAt: Date.now(), realized: 0, buys: 0, sells: 0 }, ...grids]);
  return null;
}

export function updateGrid(id: string, patch: Partial<Grid> | ((g: Grid) => Partial<Grid>)) {
  load();
  save(grids.map((g) => (g.id === id ? { ...g, ...(typeof patch === "function" ? patch(g) : patch) } : g)));
}

export function removeGrid(id: string) {
  load();
  save(grids.filter((g) => g.id !== id));
}

/** Tokens a grid holds (bought and not yet sold back). */
export const gridTokens = (g: Grid) => g.slots.reduce((t, s) => t + (s.state === "sell" ? s.tokens : 0), 0);
