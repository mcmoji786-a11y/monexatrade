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
  maxBundlePct: 20,
};

export type Check = { label: string; ok: boolean; detail: string };

/** Every new-launch check with its result, for the "why" popover. */
export function newLaunchChecks(t: FeedToken, alt: MarketToken | null, repeatedSymbol: boolean, nowSecs: number): Check[] {
  const L = NEW_LAUNCH;
  const m = t.market;
  // Coins quoted in another currency (USD1...) have no USD price here, but every check
  // uses trades and wallets, not price.
  if (!m) return [{ label: "Live market", ok: false, detail: "No trades decoded yet" }];
  const pump = t.launchpad === "pump.fun";
  // LaunchLab logs no trader, so its holders and concentration come from the provider.
  const ownWallets = t.launchpad !== "letsbonk.fun" && t.launchpad !== "raydium-launchlab";
  const holders = ownWallets ? m.holders : alt?.holders ?? null;
  const top10 = ownWallets ? m.top10_pct : alt?.top_holders_pct ?? null;
  const age = nowSecs - t.timestamp;
  const socials = !!t.meta && !!(t.meta.twitter || t.meta.telegram || t.meta.website);
  const n = (v: number | null, d = 0) => (v == null ? "unknown" : v.toFixed(d));
  return [
    { label: "2 minutes or older", ok: age >= L.minAgeSecs, detail: `${Math.floor(age / 60)}m ${Math.floor(age % 60)}s old` },
    { label: `${L.minTrades}+ trades`, ok: m.trades_total >= L.minTrades, detail: `${m.trades_total} trades` },
    { label: "Mint authority revoked", ok: pump || alt?.mint_authority_disabled === true, detail: pump ? "Revoked at creation" : alt ? "From market data" : "Not confirmed yet" },
    { label: "Freeze authority revoked", ok: pump || alt?.freeze_authority_disabled === true, detail: pump ? "Revoked at creation" : alt ? "From market data" : "Not confirmed yet" },
    { label: `${L.minHolders}+ holders`, ok: holders != null && holders >= L.minHolders, detail: `${n(holders)} holders` },
    { label: `Top 10 under ${L.maxTop10Pct}%`, ok: top10 != null && top10 <= L.maxTop10Pct, detail: `${n(top10)}%` },
    { label: `Dev under ${L.maxDevPct}%`, ok: ownWallets && m.dev_pct <= L.maxDevPct, detail: ownWallets ? `${m.dev_pct.toFixed(1)}%` : "Not recorded for this coin" },
    { label: "Dev has not sold out", ok: !m.dev_sold_all, detail: m.dev_sold_all ? "Dev sold everything" : m.dev_sells ? `${m.dev_sells} dev sells` : "No dev sells" },
    { label: `Early buyers under ${L.maxEarlyBuyerPct}%`, ok: m.sniper_pct <= L.maxEarlyBuyerPct, detail: `${m.sniper_pct.toFixed(1)}% held by ${m.snipers}` },
    { label: "Buys keep up with sells", ok: m.sells_1h <= m.buys_1h * L.maxSellRatio, detail: `${m.buys_1h} buys / ${m.sells_1h} sells` },
    { label: "No crash in 5 minutes", ok: (m.change_5m_pct ?? 0) >= L.minChange5mPct, detail: m.change_5m_pct == null ? "No change yet" : `${m.change_5m_pct.toFixed(1)}%` },
    { label: `Bundles under ${L.maxBundlePct}%`, ok: m.bundle_pct <= L.maxBundlePct, detail: m.bundled ? `${m.bundle_pct.toFixed(1)}% held by ${m.bundled} bundled wallets` : "No bundles seen" },
    {
      label: "Dev has no rugs on record",
      ok: !(t.dev_report && t.dev_report.rugged > 0),
      detail: !t.dev_report?.coins ? "No earlier coins seen" : `${t.dev_report.rugged} of ${t.dev_report.coins} earlier coins rugged`,
    },
    { label: "Unique symbol", ok: !repeatedSymbol, detail: repeatedSymbol ? "Another coin already uses it" : "No other coin uses it" },
    { label: "Has social links", ok: socials, detail: socials ? "X, Telegram or website" : "None" },
  ];
}

/** Labels of the failed checks; empty means the coin passes. */
export function newLaunchFlags(t: FeedToken, alt: MarketToken | null, repeatedSymbol: boolean, nowSecs: number): string[] {
  return newLaunchChecks(t, alt, repeatedSymbol, nowSecs).filter((c) => !c.ok).map((c) => c.label);
}

/** One plain line about a new coin: the most important facts first, at most three.
 *  Built from rules over our own data; the AI analysis button goes deeper. */
export function launchSummary(t: FeedToken, smartHolders: number): string | null {
  const m = t.market;
  const d = t.dev_report;
  const parts: string[] = [];
  if (d && d.rugged > 0) parts.push(`Dev rugged ${d.rugged} of ${d.coins} earlier coins`);
  else if (d && d.coins >= 3 && d.died_fast >= d.coins * 0.8) parts.push(`Dev's last ${d.coins} coins died fast`);
  if (m?.dev_sold_all) parts.push("Dev sold everything");
  else if (m && m.dev_sells > 0) parts.push("Dev is selling");
  if (m && m.bundle_pct >= 20) parts.push(`Bundled wallets hold ${m.bundle_pct.toFixed(0)}%`);
  if (m && m.top10_pct >= 50) parts.push(`Top 10 hold ${m.top10_pct.toFixed(0)}%`);
  if (smartHolders > 0) parts.push(`${smartHolders} smart wallet${smartHolders === 1 ? "" : "s"} holding`);
  if (d && d.graduated > 0 && d.rugged === 0) parts.push(`Dev graduated ${d.graduated} earlier coin${d.graduated === 1 ? "" : "s"}`);
  if (m && m.holders_change_1h >= 50) parts.push(`+${m.holders_change_1h} holders in the last hour`);
  if (m && m.holders_change_1h <= -20) parts.push(`${m.holders_change_1h} holders in the last hour`);
  return parts.length ? parts.slice(0, 3).join(" · ") : null;
}
