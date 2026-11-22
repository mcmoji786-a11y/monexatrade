/* A wallet's report in plain words, from its swaps: what kind of trader it is, how it
   did, how long it holds, its best and worst coins and its profit day by day. Rules, not
   AI: every line and badge comes from the numbers shown next to it. Pure functions, so
   the Wallet Tracker and tests use the same math. */

/** One swap. `amount` is in the same unit for every swap of a coin (raw units from the
 *  on-chain history, tokens from Kixo's live feed). */
export type ReportTrade = { mint: string; symbol: string; buy: boolean; sol: number; amount: number; time: number };

export type CoinResult = {
  mint: string;
  symbol: string;
  boughtSol: number;
  soldSol: number;
  /** Profit on what was sold, against the average buy price. Null when it sold coins it
   *  bought before the period (no buy price known). */
  realizedSol: number | null;
  firstBuy: number | null;
  lastSell: number | null;
  /** First buy to last sell, for coins bought and sold in the period. */
  holdSecs: number | null;
  /** Sold all it bought (within 1%). */
  closed: boolean;
};

export type Badge = { key: string; label: string; why: string; tone: "good" | "bad" | "info" };

export type WalletReport = {
  trades: number;
  buys: number;
  sells: number;
  /** Swaps per hour over the hours it was active (first to last swap). */
  perHour: number | null;
  medianGapSecs: number | null;
  avgBuySol: number | null;
  coins: CoinResult[];
  /** Coins with a known profit (sold, with a buy in the period). */
  scored: number;
  wins: number;
  winRate: number | null;
  realizedSol: number;
  /** Realized profit against what those sales cost. */
  roiPct: number | null;
  medianHoldSecs: number | null;
  /** Share of coins from pump.fun (their addresses end in "pump"). */
  pumpShare: number | null;
  /** Realized profit per day, oldest first, `days` long, by the day of each sale. */
  daily: { day: string; sol: number }[];
  best: CoinResult[];
  worst: CoinResult[];
  lastTrade: number | null;
  badges: Badge[];
  summary: string;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** "3 min", "2 h", "45 s", "4 days". */
export function span(secs: number) {
  if (secs < 90) return `${Math.max(1, Math.round(secs))} s`;
  if (secs < 5400) return `${Math.round(secs / 60)} min`;
  if (secs < 172800) return `${Math.round(secs / 3600)} h`;
  return `${Math.round(secs / 86400)} days`;
}

const sol = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 3 })} SOL`;

/** Local calendar day, YYYY-MM-DD. */
const dayOf = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function walletReport(input: ReportTrade[], opts: { nowSecs: number; days: number; holdingsUsd?: number | null; labels?: string[] }): WalletReport {
  const trades = [...input].sort((a, b) => a.time - b.time);
  const buys = trades.filter((t) => t.buy);
  const sells = trades.filter((t) => !t.buy);

  // Per coin, in time order: the average buy price so far prices each sale.
  const byCoin = new Map<string, { symbol: string; bSol: number; bAmt: number; sSol: number; sAmt: number; realized: number; unknown: boolean; firstBuy: number | null; lastSell: number | null }>();
  const dailyMap = new Map<string, number>();
  for (const t of trades) {
    const c = byCoin.get(t.mint) ?? { symbol: t.symbol, bSol: 0, bAmt: 0, sSol: 0, sAmt: 0, realized: 0, unknown: false, firstBuy: null, lastSell: null };
    if (!c.symbol && t.symbol) c.symbol = t.symbol;
    if (t.buy) {
      c.bSol += t.sol;
      c.bAmt += t.amount;
      c.firstBuy ??= t.time;
    } else {
      // Only the part covered by buys seen in the period has a known cost.
      const left = c.bAmt - c.sAmt;
      const covered = Math.max(0, Math.min(t.amount, left));
      if (covered > 0 && c.bAmt > 0) {
        const part = t.amount > 0 ? covered / t.amount : 0;
        const r = t.sol * part - (c.bSol / c.bAmt) * covered;
        c.realized += r;
        dailyMap.set(dayOf(t.time), (dailyMap.get(dayOf(t.time)) ?? 0) + r);
      }
      if (covered < t.amount * 0.99) c.unknown = true;
      c.sSol += t.sol;
      c.sAmt += t.amount;
      c.lastSell = t.time;
    }
    byCoin.set(t.mint, c);
  }

  const coins: CoinResult[] = [...byCoin.entries()].map(([mint, c]) => {
    const scored = c.bAmt > 0 && c.sAmt > 0;
    return {
      mint,
      symbol: c.symbol,
      boughtSol: c.bSol,
      soldSol: c.sSol,
      realizedSol: scored && !(c.unknown && c.realized === 0) ? c.realized : null,
      firstBuy: c.firstBuy,
      lastSell: c.lastSell,
      holdSecs: c.firstBuy != null && c.lastSell != null && c.lastSell >= c.firstBuy ? c.lastSell - c.firstBuy : null,
      closed: c.bAmt > 0 && c.sAmt >= c.bAmt * 0.99,
    };
  });

  const scored = coins.filter((c) => c.realizedSol != null);
  const wins = scored.filter((c) => (c.realizedSol ?? 0) > 0).length;
  const realizedSol = scored.reduce((s, c) => s + (c.realizedSol ?? 0), 0);
  // What the sold part cost: sold value minus profit.
  const soldCost = scored.reduce((s, c) => s + Math.max(0, c.soldSol - (c.realizedSol ?? 0)), 0);
  const holds = coins.filter((c) => c.holdSecs != null).map((c) => c.holdSecs!);
  const gaps = trades.slice(1).map((t, i) => t.time - trades[i].time);
  const first = trades[0]?.time ?? null;
  const last = trades.at(-1)?.time ?? null;
  const activeHours = first != null && last != null ? Math.max(1, (last - first) / 3600) : null;
  const pumpCoins = coins.filter((c) => c.mint.endsWith("pump")).length;

  const daily: { day: string; sol: number }[] = [];
  for (let i = opts.days - 1; i >= 0; i--) {
    const d = dayOf(opts.nowSecs - i * 86400);
    daily.push({ day: d, sol: dailyMap.get(d) ?? 0 });
  }

  const ranked = [...scored].sort((a, b) => (b.realizedSol ?? 0) - (a.realizedSol ?? 0));
  const r: WalletReport = {
    trades: trades.length,
    buys: buys.length,
    sells: sells.length,
    perHour: activeHours != null && trades.length >= 2 ? trades.length / activeHours : null,
    medianGapSecs: median(gaps),
    avgBuySol: buys.length ? buys.reduce((s, t) => s + t.sol, 0) / buys.length : null,
    coins,
    scored: scored.length,
    wins,
    winRate: scored.length ? (wins / scored.length) * 100 : null,
    realizedSol,
    roiPct: soldCost > 0 ? (realizedSol / soldCost) * 100 : null,
    medianHoldSecs: median(holds),
    pumpShare: coins.length ? pumpCoins / coins.length : null,
    daily,
    best: ranked.filter((c) => (c.realizedSol ?? 0) > 0).slice(0, 5),
    worst: ranked.filter((c) => (c.realizedSol ?? 0) < 0).reverse().slice(0, 5),
    lastTrade: last,
    badges: [],
    summary: "",
  };
  r.badges = badgesOf(r, opts);
  r.summary = summaryOf(r, opts);
  return r;
}

function badgesOf(r: WalletReport, opts: { nowSecs: number; holdingsUsd?: number | null; labels?: string[] }): Badge[] {
  const out: Badge[] = [];
  const labels = new Set(opts.labels ?? []);
  if (r.perHour != null && r.perHour >= 60 && (r.medianGapSecs ?? 99) < 15)
    out.push({ key: "bot", label: "Bot-like", why: `About ${Math.round(r.perHour)} swaps an hour, usually ${Math.round(r.medianGapSecs ?? 0)} s apart: faster than a person clicks`, tone: "info" });
  if (labels.has("sniper")) out.push({ key: "sniper", label: "Sniper", why: "Kixo saw it buy coins in their first seconds after launch", tone: "info" });
  if (labels.has("dev")) out.push({ key: "dev", label: "Coin creator", why: "Kixo saw this wallet create coins", tone: "info" });
  if (labels.has("bundler")) out.push({ key: "bundler", label: "Bundler", why: "It bought in the same block as other wallets at a launch, a sign of one person using many wallets", tone: "bad" });
  if (r.medianHoldSecs != null && r.scored >= 3 && r.medianHoldSecs < 600)
    out.push({ key: "scalper", label: "Scalper", why: `Usually sells within ${span(r.medianHoldSecs)} of buying`, tone: "info" });
  if (r.medianHoldSecs != null && r.scored >= 3 && r.medianHoldSecs > 6 * 3600)
    out.push({ key: "swing", label: "Holds for hours", why: `Usually holds a coin about ${span(r.medianHoldSecs)}`, tone: "info" });
  if ((r.avgBuySol ?? 0) >= 5 || (opts.holdingsUsd ?? 0) >= 100_000 || labels.has("whale"))
    out.push({ key: "whale", label: "Whale", why: (r.avgBuySol ?? 0) >= 5 ? `Its buys average ${(r.avgBuySol ?? 0).toFixed(1)} SOL` : "Holds a large amount", tone: "info" });
  if (r.scored >= 5 && r.realizedSol > 0 && (r.winRate ?? 0) >= 60)
    out.push({ key: "winner", label: "Profitable", why: `${Math.round(r.winRate ?? 0)}% of the coins it sold made a profit, ${sol(r.realizedSol)} in total`, tone: "good" });
  if (r.scored >= 5 && r.realizedSol < 0 && (r.winRate ?? 100) < 40)
    out.push({ key: "loser", label: "Losing", why: `Only ${Math.round(r.winRate ?? 0)}% of the coins it sold made a profit, ${sol(r.realizedSol)} in total`, tone: "bad" });
  if ((r.pumpShare ?? 0) >= 0.7 && r.coins.length >= 3)
    out.push({ key: "pump", label: "pump.fun trader", why: `${Math.round((r.pumpShare ?? 0) * 100)}% of its coins come from pump.fun`, tone: "info" });
  if (r.lastTrade != null && opts.nowSecs - r.lastTrade > 7 * 86400)
    out.push({ key: "quiet", label: "Quiet", why: `No swaps for ${span(opts.nowSecs - r.lastTrade)}`, tone: "info" });
  return out;
}

function summaryOf(r: WalletReport, opts: { nowSecs: number; days: number }): string {
  if (!r.trades) return `No swaps in the last ${opts.days} days`;
  const kind = r.badges.some((b) => b.key === "bot")
    ? "An automated trading wallet"
    : r.badges.some((b) => b.key === "scalper")
      ? "A fast memecoin trader"
      : r.badges.some((b) => b.key === "swing")
        ? "A memecoin holder"
        : r.trades < 5
          ? "A quiet wallet"
          : "A memecoin trader";
  const parts: string[] = [];
  if (r.perHour != null && r.trades >= 10) parts.push(r.perHour >= 1 ? `about ${Math.round(r.perHour)} swaps an hour while active` : `${r.trades} swaps in ${opts.days} days`);
  else parts.push(`${r.trades} swap${r.trades === 1 ? "" : "s"} in ${opts.days} days`);
  if ((r.pumpShare ?? 0) >= 0.7 && r.coins.length >= 3) parts.push("mostly pump.fun coins");
  if (r.medianHoldSecs != null && r.scored >= 3) parts.push(`usually sells within ${span(r.medianHoldSecs)}`);
  let s = `${kind}: ${parts.join(", ")}.`;
  if (r.scored) {
    s += ` ${opts.days === 30 ? "Last 30 days" : `Last ${opts.days} days`}: ${sol(r.realizedSol)} realized`;
    if (r.winRate != null) s += `, ${Math.round(r.winRate)}% of the coins it sold in profit`;
    s += ".";
  }
  return s;
}
