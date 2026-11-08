"use client";

/** Orders: limit buys and sells, stop losses and trailing stops, the same on demo and real.
 *
 *  Demo orders live on the gateway (demo.rs), which watches them around the clock.
 *  Real orders are kept in this browser and watched here while Kixo is open (founder
 *  decision 2026-11-08: the key never leaves the browser). Both fire on the same live
 *  price (gateway `/price`) and follow the same rules (demo.rs check_order/triggered). */

import { useSyncExternalStore } from "react";
import { currentUserId } from "./account";
import { GATEWAY_HTTP } from "./gateway";
import { createRule, type DemoRule } from "./growth";
import { refreshDemo } from "./demo";

export type OrderKind = "limit_buy" | "limit_sell" | "sl" | "trail";
/** How each order type is shown. Demo take profits ("tp") read as limit sells. */
export const ORDER_TEXT: Record<OrderKind | "tp", { label: string; short: string; tone: "good" | "bad" }> = {
  limit_buy: { label: "Limit buy", short: "Buy at", tone: "good" },
  limit_sell: { label: "Limit sell", short: "Sell at", tone: "good" },
  tp: { label: "Take profit", short: "Sell at", tone: "good" },
  sl: { label: "Stop loss", short: "Sell at", tone: "bad" },
  trail: { label: "Trailing stop", short: "Trail", tone: "bad" },
};

/* ---------------- The shared rules ---------------- */

export type OrderInput = {
  mint: string;
  symbol: string;
  kind: OrderKind;
  /** The price that fires a limit order or stop loss, in USD. */
  priceUsd?: number;
  /** Sells: share of the position, 0 to 1. */
  fraction?: number;
  /** Limit buys: USD on demo, SOL on real. */
  amount?: number;
  /** Trailing stops: % below the highest price since placing. */
  trailPct?: number;
};

/** Checks an order against the live price; the same rules as the gateway's check_order. */
export function checkOrder(o: OrderInput, price: number | null, holds: boolean): string | null {
  if (!price || !(price > 0)) return "This coin has no live price yet";
  const f = o.fraction ?? 1;
  if (o.kind !== "limit_buy" && !(f > 0 && f <= 1)) return "Choose how much to sell";
  if (o.kind !== "limit_buy" && !holds) return "Buy the coin first";
  switch (o.kind) {
    case "limit_buy":
      if (!o.priceUsd || !(o.priceUsd > 0)) return "Enter a price";
      if (o.priceUsd >= price) return "A limit buy must be below the current price";
      if (!o.amount || !(o.amount > 0)) return "Enter an amount";
      return null;
    case "limit_sell":
      if (!o.priceUsd || !(o.priceUsd > 0)) return "Enter a price";
      return o.priceUsd <= price ? "A limit sell must be above the current price" : null;
    case "sl":
      if (!o.priceUsd || !(o.priceUsd > 0)) return "Enter a price";
      return o.priceUsd >= price ? "A stop loss must be below the current price" : null;
    case "trail":
      return o.trailPct && o.trailPct >= 1 && o.trailPct <= 90 ? null : "Trailing stop must be between 1% and 90%";
  }
}

/** Has the price crossed the trigger? (demo.rs `triggered`) */
export function triggered(kind: OrderKind, trigger: number, price: number) {
  return kind === "limit_sell" ? price >= trigger : price <= trigger;
}

/** A trailing stop after a new price: highest price and trigger (demo.rs `trail_step`). */
export function trailStep(peak: number, trailPct: number, price: number) {
  const high = Math.max(peak, price);
  return { high, trigger: high * (1 - trailPct / 100) };
}

/* ---------------- Live prices ---------------- */

/** The prices the gateway's demo engine fills against, for these coins. */
export async function fetchPrices(mints: string[]): Promise<Record<string, number | null>> {
  if (!mints.length) return {};
  const r = await fetch(`${GATEWAY_HTTP}/price?mints=${mints.slice(0, 20).join(",")}`, { cache: "no-store" });
  return r.ok ? ((await r.json()) as Record<string, number | null>) : {};
}

/* ---------------- Demo orders ---------------- */

/** Places a demo order on the gateway. On a database without update 0009 a limit sell
 *  goes as a take profit by price, which the gateway checks with the same rule. */
export async function placeDemoOrder(o: OrderInput) {
  const body = (kind: DemoRule["kind"]) => ({
    mint: o.mint,
    kind,
    ...(o.priceUsd != null && o.kind !== "trail" ? { price_usd: o.priceUsd } : {}),
    ...(o.kind === "limit_buy" ? { usd: o.amount } : { fraction: o.fraction ?? 1 }),
    ...(o.kind === "trail" ? { trail_pct: o.trailPct } : {}),
  });
  try {
    await createRule(body(o.kind));
  } catch (e) {
    if (o.kind !== "limit_sell" || !String(e instanceof Error ? e.message : e).includes("0009")) throw e;
    await createRule(body("tp"));
  }
  await refreshDemo();
}

/* ---------------- Real orders (this browser) ---------------- */

export type RealOrder = {
  id: string;
  mint: string;
  symbol: string;
  kind: OrderKind;
  /** Fires at this price (trailing stops: moves up with the peak). */
  trigger: number;
  /** Sells: share of the position. Buys: SOL to spend. */
  fraction?: number;
  sol?: number;
  trailPct?: number;
  peak?: number;
  status: "open" | "filling" | "filled" | "failed" | "cancelled";
  note?: string;
  createdAt: number;
  doneAt?: number;
  signature?: string;
};

const MAX_OPEN = 20;
const KEEP_DONE = 100;
let orders: RealOrder[] = [];
let loadedFor: string | null | undefined;
const subs = new Set<() => void>();
const keyFor = (uid: string | null) => `kixo.orders.${uid ?? "anon"}`;

function load() {
  const uid = currentUserId();
  if (loadedFor === uid || typeof window === "undefined") return;
  loadedFor = uid;
  try {
    orders = JSON.parse(localStorage.getItem(keyFor(uid)) ?? "[]") as RealOrder[];
    // An order caught mid-fill when the tab closed is not known to have filled.
    orders = orders.map((o) => (o.status === "filling" ? { ...o, status: "failed", note: "Kixo was closed while it filled: check your wallet" } : o));
  } catch {
    orders = [];
  }
}

function save(next: RealOrder[]) {
  const open = next.filter((o) => o.status === "open" || o.status === "filling");
  const done = next.filter((o) => o.status !== "open" && o.status !== "filling").slice(0, KEEP_DONE);
  orders = [...open, ...done];
  try {
    localStorage.setItem(keyFor(loadedFor ?? null), JSON.stringify(orders));
  } catch {}
  subs.forEach((f) => f());
}

export function getRealOrders() {
  load();
  return orders;
}

const EMPTY: RealOrder[] = [];
export function useRealOrders(): RealOrder[] {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => (load(), orders),
    () => EMPTY,
  );
}

/** Adds a real order, checked against the live price. Returns an error to show, or null. */
export function addRealOrder(o: OrderInput, price: number | null, holds: boolean): string | null {
  load();
  const err = checkOrder(o, price, holds);
  if (err) return err;
  if (orders.filter((x) => x.status === "open").length >= MAX_OPEN) return `At most ${MAX_OPEN} open orders`;
  const trail = o.kind === "trail";
  save([
    {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      mint: o.mint,
      symbol: o.symbol,
      kind: o.kind,
      trigger: trail ? price! * (1 - o.trailPct! / 100) : o.priceUsd!,
      ...(o.kind === "limit_buy" ? { sol: o.amount } : { fraction: o.fraction ?? 1 }),
      ...(trail ? { trailPct: o.trailPct, peak: price! } : {}),
      status: "open",
      createdAt: Date.now(),
    },
    ...orders,
  ]);
  return null;
}

export function updateRealOrder(id: string, patch: Partial<RealOrder>) {
  load();
  save(orders.map((o) => (o.id === id ? { ...o, ...patch } : o)));
}

export function cancelRealOrder(id: string) {
  updateRealOrder(id, { status: "cancelled", note: "Cancelled", doneAt: Date.now() });
}

/** Cancels a coin's open real sell orders (after its position is sold off). */
export function cancelRealSells(mint: string, note: string) {
  load();
  save(orders.map((o) => (o.mint === mint && o.status === "open" && o.kind !== "limit_buy" ? { ...o, status: "cancelled", note, doneAt: Date.now() } : o)));
}
