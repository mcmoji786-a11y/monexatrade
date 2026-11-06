import type { DiscoverRow } from "./categories";
import type { FeedToken, Market, MarketToken, Position } from "./gateway";

export type RiskLevel = "low" | "medium" | "high";
export type Risk = { score: number; level: RiskLevel; reasons: string[] };

/** 0 (calm) to 100 (dangerous), from facts we can see on chain. Each factor adds
 *  points and a plain reason. It describes the token, it is not trading advice. */
export function riskOf(r: DiscoverRow, curve: Market | null, provider: MarketToken | null, dev: Position | null): Risk {
  let score = 0;
  const reasons: string[] = [];
  const add = (pts: number, why: string) => {
    score += pts;
    reasons.push(why);
  };

  if (provider && !provider.mint_authority_disabled) add(30, "Mint authority is active: more tokens can be created");
  if (provider?.freeze_authority_disabled === false) add(20, "Freeze authority is active: wallets can be frozen");

  const top10 = r.top10Pct ?? 0;
  if (top10 > 50) add(25, `Top 10 wallets hold ${top10.toFixed(0)}%`);
  else if (top10 > 30) add(12, `Top 10 wallets hold ${top10.toFixed(0)}%`);

  const devPct = r.devPct ?? 0;
  if (devPct > 20) add(20, `Dev still holds ${devPct.toFixed(0)}%`);
  else if (devPct > 10) add(10, `Dev holds ${devPct.toFixed(0)}%`);

  if (dev && dev.bought_sol > 0 && dev.balance === 0) add(15, `Dev sold everything (${dev.sold_sol.toFixed(2)} SOL)`);
  else if (dev && dev.sold_tokens > 0) add(8, "Dev has started selling");

  const sniperPct = r.sniperPct ?? 0;
  if (sniperPct > 15) add(15, `Early buyers (first 3 seconds) still hold ${sniperPct.toFixed(0)}%`);
  else if (sniperPct > 5) add(7, `Early buyers (first 3 seconds) hold ${sniperPct.toFixed(0)}%`);

  const buys = r.buys1h ?? 0;
  const sells = r.sells1h ?? 0;
  if (buys + sells >= 20 && sells > buys * 1.5) add(10, "Sells outnumber buys 3 to 2 in the last hour");

  if (curve && !curve.complete && curve.trades_total < 10) add(10, "Fewer than 10 trades so far");
  if ((r.liquidityUsd ?? Infinity) < 5_000) add(8, "Liquidity under $5K");

  score = Math.min(100, score);
  const level: RiskLevel = score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  if (!reasons.length) reasons.push("No red flags in holders, dev or authorities");
  return { score, level, reasons };
}

/** Lower-risk check for a brand-new launch (Sol Radar). New coins cannot be judged by
 *  age or size, so this looks at how the first minutes went. Every check must pass;
 *  unknown counts as a fail. Fewer red flags, not a guarantee.
 *  Not yet included: the creator's history across earlier coins. */
export const NEW_LAUNCH = {
  minAgeSecs: 120,
  minTrades: 30,
  minHolders: 25,
  maxTop10Pct: 30,
  maxDevPct: 5,
  maxEarlyBuyerPct: 10,
  /** Sells may outnumber buys by at most this factor in the last hour. */
  maxSellRatio: 1.2,
  minChange5mPct: -30,
};

export function newLaunchFlags(t: FeedToken, alt: MarketToken | null, repeatedSymbol: boolean, nowSecs: number): string[] {
  const L = NEW_LAUNCH;
  const m = t.market;
  const flags: string[] = [];
  // Coins quoted in another currency (USD1...) have no USD price here, but every check
  // below uses trades and wallets, not price.
  if (!m) return ["No live market yet"];
  if (nowSecs - t.timestamp < L.minAgeSecs) flags.push("Younger than 2 minutes");
  if (m.trades_total < L.minTrades) flags.push(`Fewer than ${L.minTrades} trades`);

  // pump.fun revokes mint and freeze at creation; other launchpads need the provider.
  const pump = t.launchpad === "pump.fun";
  if (!pump && alt?.mint_authority_disabled !== true) flags.push("Mint authority not confirmed revoked");
  if (!pump && alt?.freeze_authority_disabled !== true) flags.push("Freeze authority not confirmed revoked");

  // LaunchLab logs no trader, so its holders and concentration come from the provider.
  const ownWallets = t.launchpad !== "letsbonk.fun" && t.launchpad !== "raydium-launchlab";
  const holders = ownWallets ? m.holders : alt?.holders ?? null;
  const top10 = ownWallets ? m.top10_pct : alt?.top_holders_pct ?? null;
  if (holders == null || holders < L.minHolders) flags.push(`Fewer than ${L.minHolders} holders`);
  if (top10 == null || top10 > L.maxTop10Pct) flags.push(`Top 10 hold over ${L.maxTop10Pct}% or unknown`);
  if (!ownWallets) flags.push("Dev share unknown on this launchpad");
  else if (m.dev_pct > L.maxDevPct) flags.push(`Dev holds over ${L.maxDevPct}%`);
  if (m.sniper_pct > L.maxEarlyBuyerPct) flags.push(`Early buyers hold over ${L.maxEarlyBuyerPct}%`);

  if (m.sells_1h > m.buys_1h * L.maxSellRatio) flags.push("More sells than buys");
  if ((m.change_5m_pct ?? 0) < L.minChange5mPct) flags.push("Down over 30% in 5 minutes");
  if (repeatedSymbol) flags.push("Another new coin uses the same symbol");
  if (!t.meta || !(t.meta.twitter || t.meta.telegram || t.meta.website)) flags.push("No social links");
  return flags;
}
