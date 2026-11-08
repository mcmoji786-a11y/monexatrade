/* Achievements, streaks and the weekly recap, all from the demo trade history. Pure
   functions (no React), so they are easy to test and the same everywhere. */

export type TradeLike = {
  id: number;
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  usd: number;
  realized_usd: number | null;
  source: string;
  ts: string;
};

export type AchievementId =
  | "first_trade"
  | "first_profit"
  | "ten_trades"
  | "hundred_trades"
  | "double"
  | "tenx"
  | "win_streak_3"
  | "win_streak_5"
  | "day_streak_3"
  | "day_streak_7"
  | "protected"
  | "took_profit"
  | "quick"
  | "sniper"
  | "grid"
  | "copy";

export const ACHIEVEMENTS: { id: AchievementId; title: string; desc: string }[] = [
  { id: "first_trade", title: "First trade", desc: "Place your first trade" },
  { id: "first_profit", title: "First profit", desc: "Sell a coin for more than it cost" },
  { id: "ten_trades", title: "10 trades", desc: "Place 10 trades" },
  { id: "hundred_trades", title: "100 trades", desc: "Place 100 trades" },
  { id: "double", title: "Doubled", desc: "Sell a coin at 2x or more" },
  { id: "tenx", title: "10x", desc: "Sell a coin at 10x or more" },
  { id: "win_streak_3", title: "Hot hand", desc: "3 profitable sells in a row" },
  { id: "win_streak_5", title: "On fire", desc: "5 profitable sells in a row" },
  { id: "day_streak_3", title: "3-day streak", desc: "Trade 3 days in a row" },
  { id: "day_streak_7", title: "7-day streak", desc: "Trade 7 days in a row" },
  { id: "protected", title: "Protected", desc: "A stop loss or trailing stop sells for you" },
  { id: "took_profit", title: "Planned exit", desc: "A take profit or limit sell fills" },
  { id: "quick", title: "Quick draw", desc: "Buy with Quick Buy" },
  { id: "sniper", title: "Sniper", desc: "The sniper bot trades for you" },
  { id: "grid", title: "Grid trader", desc: "A grid buys or sells for you" },
  { id: "copy", title: "Copycat", desc: "Copy a smart wallet's trade" },
];

/** P&L of a sell as a share of what the sold tokens cost, in %. */
export function sellPct(t: TradeLike): number | null {
  if (t.side !== "sell" || t.realized_usd == null) return null;
  const cost = Number(t.usd) - Number(t.realized_usd);
  return cost > 0 ? (Number(t.realized_usd) / cost) * 100 : null;
}

const DAY = 86_400_000;
const dayOf = (ts: string) => Math.floor(new Date(ts).getTime() / DAY);

/** Longest run of consecutive UTC days in a sorted list of distinct days, and the run
 *  that ends today or yesterday (still alive). */
function dayRuns(days: number[], today: number) {
  let best = 0;
  let run = 0;
  let prev = -2;
  for (const d of days) {
    run = d === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const current = days.length && today - days[days.length - 1] <= 1 ? run : 0;
  return { best, current };
}

export type Progress = {
  /** When each achievement was earned (ISO time of the trade that earned it). */
  unlocked: Partial<Record<AchievementId, string>>;
  dayStreak: number;
  bestDayStreak: number;
  winStreak: number;
  bestWinStreak: number;
};

export function progress(trades: TradeLike[], nowMs = Date.now()): Progress {
  const list = trades.slice().sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id);
  const unlocked: Progress["unlocked"] = {};
  const earn = (id: AchievementId, ts: string) => {
    if (!unlocked[id]) unlocked[id] = ts;
  };
  let winRun = 0;
  let bestWin = 0;
  const days: number[] = [];
  let dayRun = 0;
  let prevDay = -2;
  list.forEach((t, i) => {
    earn("first_trade", t.ts);
    if (i + 1 >= 10) earn("ten_trades", t.ts);
    if (i + 1 >= 100) earn("hundred_trades", t.ts);
    const d = dayOf(t.ts);
    if (d !== prevDay) {
      days.push(d);
      dayRun = d === prevDay + 1 ? dayRun + 1 : 1;
      prevDay = d;
      if (dayRun >= 3) earn("day_streak_3", t.ts);
      if (dayRun >= 7) earn("day_streak_7", t.ts);
    }
    if (t.source === "quick") earn("quick", t.ts);
    if (t.source === "sniper") earn("sniper", t.ts);
    if (t.source === "grid") earn("grid", t.ts);
    if (t.source === "copy") earn("copy", t.ts);
    if (t.side === "sell" && t.realized_usd != null) {
      const pnl = Number(t.realized_usd);
      const pct = sellPct(t);
      if (pnl > 0) earn("first_profit", t.ts);
      if (pct != null && pct >= 100) earn("double", t.ts);
      if (pct != null && pct >= 900) earn("tenx", t.ts);
      if (t.source === "sl" || t.source === "trail") earn("protected", t.ts);
      if (t.source === "tp" || t.source === "limit_sell") earn("took_profit", t.ts);
      winRun = pnl > 0 ? winRun + 1 : 0;
      bestWin = Math.max(bestWin, winRun);
      if (winRun >= 3) earn("win_streak_3", t.ts);
      if (winRun >= 5) earn("win_streak_5", t.ts);
    }
  });
  const runs = dayRuns(days, Math.floor(nowMs / DAY));
  return { unlocked, dayStreak: runs.current, bestDayStreak: runs.best, winStreak: winRun, bestWinStreak: bestWin };
}

/* ---------------- Weekly recap ---------------- */

/** Monday 00:00 UTC of the week holding `ms`, as ms. */
export function weekStart(ms: number) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

export type Recap = {
  from: number;
  to: number;
  trades: number;
  sells: number;
  wins: number;
  realizedUsd: number;
  volumeUsd: number;
  coins: number;
  best: { symbol: string; pct: number; usd: number } | null;
  dayStreak: number;
};

/** The week from Monday to Sunday (UTC): "current" so far, or the "last" full week. */
export function recap(trades: TradeLike[], which: "current" | "last", nowMs = Date.now()): Recap {
  const thisWeek = weekStart(nowMs);
  const from = which === "current" ? thisWeek : thisWeek - 7 * DAY;
  const to = which === "current" ? nowMs : thisWeek;
  const inWeek = trades.filter((t) => {
    const ms = new Date(t.ts).getTime();
    return ms >= from && ms < to;
  });
  const sells = inWeek.filter((t) => t.side === "sell" && t.realized_usd != null);
  let best: Recap["best"] = null;
  for (const s of sells) {
    const pct = sellPct(s);
    if (pct != null && Number(s.realized_usd) > 0 && (!best || pct > best.pct)) best = { symbol: s.symbol || s.mint.slice(0, 4), pct, usd: Number(s.realized_usd) };
  }
  const days = [...new Set(inWeek.map((t) => dayOf(t.ts)))].sort((a, b) => a - b);
  return {
    from,
    to,
    trades: inWeek.length,
    sells: sells.length,
    wins: sells.filter((t) => Number(t.realized_usd) > 0).length,
    realizedUsd: sells.reduce((a, t) => a + Number(t.realized_usd), 0),
    volumeUsd: inWeek.reduce((a, t) => a + Number(t.usd), 0),
    coins: new Set(inWeek.map((t) => t.mint)).size,
    best,
    dayStreak: dayRuns(days, Math.floor((to - 1) / DAY)).best,
  };
}

/* ---------------- Milestones ---------------- */

export const MILESTONES = [2, 5, 10, 25, 50, 100];

/** The highest milestone a position's value has reached (after selling costs), or 0. */
export function milestoneOf(costUsd: number, valueUsd: number | null): number {
  if (!(costUsd > 0) || valueUsd == null) return 0;
  const x = valueUsd / costUsd;
  return MILESTONES.filter((m) => x >= m).pop() ?? 0;
}
