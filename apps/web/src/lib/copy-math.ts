/** Copy trading rules, with no browser dependencies (lib/copy.ts and the copy engine use
 *  them; tested with node). */

export type CopyRules = {
  /** Per copied buy: USD on demo, SOL on real. */
  amount: number;
  /** Skip coins below this safety score (0 to 100); null: no filter. */
  minSafety: number | null;
  /** Skip coins with no safety score yet (not on Kixo's radar). */
  skipUnknown: boolean;
  /** Sell the same share the leader sells. */
  mirrorSells: boolean;
  /** Pause after losing this much in total (USD demo, SOL real); null: never. */
  maxLoss: number | null;
  /** At most this many copied buys per 24 hours. */
  maxBuysPerDay: number;
  /** Buy only when at least this many of your consensus copies bought the same coin
   *  within `consensusMins` (1: copy alone). */
  consensus: number;
  consensusMins: number;
};

export const DEFAULT_RULES: CopyRules = { amount: 25, minSafety: 50, skipUnknown: false, mirrorSells: true, maxLoss: null, maxBuysPerDay: 10, consensus: 1, consensusMins: 10 };

/** Why a leader's buy is not copied, or null to copy it. */
export function skipReason(r: CopyRules, safety: number | null, buysLast24h: number): string | null {
  if (buysLast24h >= r.maxBuysPerDay) return `Daily limit of ${r.maxBuysPerDay} copied buys reached`;
  if (safety == null) return r.skipUnknown ? "No safety score for this coin" : null;
  if (r.minSafety != null && safety < r.minSafety) return `Safety ${safety} is below ${r.minSafety}`;
  return null;
}

/** Whether enough consensus leaders bought this coin recently. `buys`: (leader, time ms)
 *  of buys of this coin by leaders in the consensus group. */
export function consensusMet(r: CopyRules, buys: { leader: string; at: number }[], now: number): boolean {
  if (r.consensus <= 1) return true;
  const since = now - r.consensusMins * 60_000;
  return new Set(buys.filter((b) => b.at >= since).map((b) => b.leader)).size >= r.consensus;
}

/** The share of our holding to sell when the leader sells `sold` tokens and keeps
 *  `left`: the same share it sold of its own position. */
export function mirrorFraction(sold: number, left: number): number {
  const before = sold + Math.max(0, left);
  return before > 0 ? Math.min(1, Math.max(0, sold / before)) : 1;
}

/** Copy cost: how much worse (+) or better (−) our price was than the leader's, in %. */
export function copyCostPct(side: "buy" | "sell", leaderPrice: number, ourPrice: number): number | null {
  if (!(leaderPrice > 0 && ourPrice > 0)) return null;
  return side === "buy" ? (ourPrice / leaderPrice - 1) * 100 : (1 - ourPrice / leaderPrice) * 100;
}

/** "Exit liquidity": the leader makes money but those copying it 3 s late lose. */
export function exitLiquidity(leaderRealizedSol: number, copyReturnPct: number | null): boolean {
  return leaderRealizedSol > 0 && copyReturnPct != null && copyReturnPct < 0;
}

/** A demo copy can move to real once it has a record worth trusting. */
export const PROMOTE_MIN_SELLS = 5;
export function promoteBlock(c: { venue: "demo" | "real"; sells: number; realized: number }, exitLiq: boolean): string | null {
  if (c.venue !== "demo") return "Already real";
  if (exitLiq) return "Its copiers lose money: it sells into them";
  if (c.sells < PROMOTE_MIN_SELLS) return `Needs ${PROMOTE_MIN_SELLS} closed copies on demo first (${c.sells} so far)`;
  if (c.realized <= 0) return "Not profitable on demo yet";
  return null;
}
