/** Grid trading math, with no browser dependencies (lib/grid.ts uses it; tested with
 *  node in scratch). See lib/grid.ts for how grids work. */

export type Slot = {
  /** Buys at `buy`, sells at `sell` (the next level up). */
  buy: number;
  sell: number;
  state: "idle" | "buy" | "sell";
  tokens: number;
  /** What the held tokens cost (USD on demo, SOL on real). */
  cost: number;
};

export const MIN_LEVELS = 3;
export const MAX_LEVELS = 20;

/** Level prices from lower to upper, evenly spaced in percent (geometric). */
export function levels(lower: number, upper: number, count: number): number[] {
  const r = Math.pow(upper / lower, 1 / count);
  return Array.from({ length: count + 1 }, (_, i) => lower * Math.pow(r, i));
}

/** The gain per completed slot, before fees, in %. */
export const stepPct = (lower: number, upper: number, count: number) => (Math.pow(upper / lower, 1 / count) - 1) * 100;

/** Checks a new grid. `roundTripPct`: fees of one buy plus one sell, in %. */
export function checkGrid(g: { lower: number; upper: number; count: number; amount: number }, price: number | null, roundTripPct: number): string | null {
  if (!price || !(price > 0)) return "This coin has no live price yet";
  if (!(g.lower > 0 && g.upper > g.lower)) return "The top of the range must be above the bottom";
  if (!(g.lower < price && g.upper > price)) return "The current price must be inside the range";
  if (!Number.isInteger(g.count) || g.count < MIN_LEVELS || g.count > MAX_LEVELS) return `Between ${MIN_LEVELS} and ${MAX_LEVELS} levels`;
  if (!(g.amount > 0)) return "Enter an amount per level";
  if (stepPct(g.lower, g.upper, g.count) <= roundTripPct) return `Levels are ${stepPct(g.lower, g.upper, g.count).toFixed(1)}% apart, less than the ${roundTripPct.toFixed(1)}% a buy and sell cost: widen the range or use fewer levels`;
  return null;
}

/** Fresh slots: those below the price are armed to buy, the rest wait. */
export function makeSlots(lower: number, upper: number, count: number, price: number): Slot[] {
  const p = levels(lower, upper, count);
  return p.slice(0, -1).map((buy, i) => ({ buy, sell: p[i + 1], state: buy < price ? "buy" : "idle", tokens: 0, cost: 0 }));
}

/** What a grid should do at this price: arm waiting slots the price has passed, then
 *  at most one trade (the deepest buy, else the lowest sell). Pure, for the engine. */
export function gridStep(slots: Slot[], price: number): { slots: Slot[]; action: { kind: "buy" | "sell"; index: number } | null } {
  const next = slots.map((s) => (s.state === "idle" && price >= s.sell ? { ...s, state: "buy" as const } : s));
  let buy = -1;
  next.forEach((s, i) => {
    if (s.state === "buy" && price <= s.buy && (buy < 0 || s.buy < next[buy].buy)) buy = i;
  });
  if (buy >= 0) return { slots: next, action: { kind: "buy", index: buy } };
  let sell = -1;
  next.forEach((s, i) => {
    if (s.state === "sell" && price >= s.sell && (sell < 0 || s.sell < next[sell].sell)) sell = i;
  });
  return { slots: next, action: sell >= 0 ? { kind: "sell", index: sell } : null };
}

