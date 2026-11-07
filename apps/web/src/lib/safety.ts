import type { DiscoverRow } from "./categories";
import type { DevReport, FeedToken, MarketToken } from "./gateway";

/* Safety score: one number from every signal Kixo has on a coin, 0 (many red
   flags) to 100 (none found). It starts at 100, each red flag takes points off and a
   few good signs add some back. Unknown data is never counted as safe: it costs a
   little, so a coin we know nothing about cannot score high. Fewer red flags, not a
   guarantee: any memecoin can still go to zero. */

export type Factor = { label: string; points: number; detail?: string };
export type Safety = { score: number; level: "higher" | "medium" | "low"; factors: Factor[] };

/** Every signal, from whichever source has it. null = unknown. */
export type Signals = {
  mintRevoked: boolean | null;
  freezeRevoked: boolean | null;
  top10Pct: number | null;
  devPct: number | null;
  devSoldAll: boolean | null;
  devSelling: boolean | null;
  devReport: DevReport | null;
  bundlePct: number | null;
  earlyPct: number | null;
  copyOfReal: boolean;
  sameXAccount: boolean;
  sameSymbol: boolean;
  hasSocials: boolean | null;
  buys1h: number | null;
  sells1h: number | null;
  change5m: number | null;
  change1h: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  ageSecs: number | null;
  organicScore: number | null;
  smartHolders: number;
  verified: boolean;
};

export function safetyScore(s: Signals): Safety {
  const f: Factor[] = [];
  const hit = (points: number, label: string, detail?: string) => f.push({ label, points, detail });

  // Authorities: the hard ways a creator can hurt holders.
  if (s.mintRevoked === false) hit(-30, "Mint authority active", "More tokens can be created");
  else if (s.mintRevoked == null) hit(-5, "Mint authority unknown");
  if (s.freezeRevoked === false) hit(-20, "Freeze authority active", "Wallets can be frozen");
  else if (s.freezeRevoked == null) hit(-3, "Freeze authority unknown");

  // Who holds it.
  const pctHit = (v: number | null, steps: [number, number][], label: string) => {
    if (v == null) return;
    const step = steps.find(([lim]) => v > lim);
    if (step) hit(-step[1], label, `${v.toFixed(0)}%`);
  };
  pctHit(s.top10Pct, [[50, 20], [30, 10], [20, 4]], "Top 10 wallets hold a lot");
  pctHit(s.devPct, [[20, 20], [10, 10], [5, 5]], "Dev holds a lot");
  pctHit(s.bundlePct, [[30, 15], [20, 10], [10, 4]], "Bundled wallets hold a share");
  // What we cannot see is a risk too: it costs a little, never counts as safe.
  if (s.top10Pct == null) hit(-5, "Top 10 share unknown");
  if (s.devPct == null) hit(-4, "Dev share unknown");
  if (s.bundlePct == null) hit(-3, "Bundles unknown");
  pctHit(s.earlyPct, [[15, 10], [10, 5]], "Early buyers (first 3 s) hold a share");

  // The dev, now and before.
  if (s.devSoldAll) hit(-15, "Dev sold everything");
  else if (s.devSelling) hit(-10, "Dev is selling");
  const d = s.devReport;
  if (d && d.rugged > 0) hit(-Math.min(30, 15 + d.rugged * 3), "Dev rugged before", `${d.rugged} of ${d.coins} earlier coins`);
  else if (d && d.coins >= 3 && d.died_fast >= d.coins * 0.8) hit(-10, "Dev's earlier coins died fast", `${d.died_fast} of ${d.coins}`);
  if (d && d.graduated > 0 && d.rugged === 0) hit(+5, "Dev graduated coins before", `${d.graduated} of ${d.coins}`);
  if (!d && (s.ageSecs == null || s.ageSecs < 7 * 86_400)) hit(-3, "Dev history unknown");

  // Copies.
  if (s.copyOfReal) hit(-25, "Copies an established coin's symbol");
  else if (s.sameSymbol) hit(-8, "Another new coin uses this symbol");
  if (s.sameXAccount) hit(-15, "X account shared with other new coins");

  // Market behaviour.
  if (s.hasSocials === false) hit(-8, "No social links");
  else if (s.hasSocials == null) hit(-4, "Social links unknown");
  const flow = (s.buys1h ?? 0) + (s.sells1h ?? 0);
  if (flow >= 20 && (s.sells1h ?? 0) > (s.buys1h ?? 0) * 1.5) hit(-8, "Sells far outnumber buys", `${s.buys1h} buys / ${s.sells1h} sells`);
  if (s.change5m != null && s.change5m <= -30) hit(-10, "Price crashed in 5 minutes", `${s.change5m.toFixed(0)}%`);
  if (s.liquidityUsd != null && s.liquidityUsd < 5_000) hit(-10, "Liquidity under $5K");
  if (s.holders == null) hit(-5, "Holder count unknown");
  // Almost nobody holds it: everyone who bought has sold, or nobody came.
  else if (s.holders < 5) hit(-30, "Almost nobody holds it", String(s.holders));
  else if (s.holders < 25) hit(-12, "Fewer than 25 holders", String(s.holders));
  else if (s.holders < 100) hit(-4, "Fewer than 100 holders", String(s.holders));
  // Young coins: most rugs happen in the first hours, and there is little to judge by.
  if (s.ageSecs != null && s.ageSecs < 120) hit(-15, "Under 2 minutes old: too new to judge");
  else if (s.ageSecs != null && s.ageSecs < 1_800) hit(-8, "Under 30 minutes old");
  else if (s.ageSecs != null && s.ageSecs < 86_400) hit(-3, "Under a day old");
  if (s.change1h != null && Math.abs(s.change1h) >= 300) hit(-5, "Very volatile", `${s.change1h > 0 ? "+" : ""}${s.change1h.toFixed(0)}% in 1h`);
  if (s.organicScore != null && s.organicScore < 30) hit(-10, "Mostly bot trading", `organic score ${s.organicScore.toFixed(0)}`);
  else if (s.organicScore != null && s.organicScore < 50) hit(-5, "Partly bot trading", `organic score ${s.organicScore.toFixed(0)}`);

  // Good signs.
  if (s.smartHolders > 0) hit(+Math.min(10, s.smartHolders * 5), "Smart wallets hold it", String(s.smartHolders));
  if (s.verified) hit(+5, "Verified token");

  const score = Math.max(0, Math.min(100, Math.round(100 + f.reduce((t, x) => t + x.points, 0))));
  f.sort((a, b) => a.points - b.points);
  return { score, level: score >= 75 ? "higher" : score >= 50 ? "medium" : "low", factors: f };
}

const ownWallets = (t: FeedToken) => t.launchpad !== "letsbonk.fun" && t.launchpad !== "raydium-launchlab";

/** Signals for a new launch on Sol Radar. */
export function launchSignals(
  t: FeedToken,
  alt: MarketToken | null,
  ctx: { copyOfReal: boolean; sameSymbol: boolean; sameXAccount: boolean; smart: number; nowSecs: number },
): Signals {
  const m = t.market;
  const own = !!m && ownWallets(t);
  const pump = t.launchpad === "pump.fun";
  return {
    mintRevoked: pump ? true : (alt?.mint_authority_disabled ?? null),
    freezeRevoked: pump ? true : (alt?.freeze_authority_disabled ?? null),
    top10Pct: own ? m.top10_pct : (alt?.top_holders_pct ?? null),
    devPct: own ? m.dev_pct : null,
    devSoldAll: m ? m.dev_sold_all : null,
    devSelling: m ? m.dev_sells > 0 : null,
    devReport: t.dev_report ?? null,
    bundlePct: own ? m.bundle_pct : null,
    earlyPct: own ? m.sniper_pct : null,
    copyOfReal: ctx.copyOfReal,
    sameXAccount: ctx.sameXAccount,
    sameSymbol: ctx.sameSymbol,
    hasSocials: t.meta ? !!(t.meta.twitter || t.meta.telegram || t.meta.website) : null,
    buys1h: m?.buys_1h ?? alt?.buys_1h ?? null,
    sells1h: m?.sells_1h ?? alt?.sells_1h ?? null,
    change5m: m?.change_5m_pct ?? alt?.change_5m_pct ?? null,
    change1h: m?.change_1h_pct ?? alt?.change_1h_pct ?? null,
    liquidityUsd: alt?.liquidity_usd ?? null,
    holders: own ? m.holders : (alt?.holders ?? null),
    ageSecs: ctx.nowSecs - t.timestamp,
    organicScore: alt?.organic_score ?? null,
    smartHolders: ctx.smart,
    verified: alt?.verified ?? false,
  };
}

/** Signals for a Discover row, with the launch record when our engine tracks it. */
export function rowSignals(r: DiscoverRow, launch: FeedToken | null, smart: number, nowSecs: number): Signals {
  const m = launch?.market ?? null;
  return {
    mintRevoked: r.mintAuthDisabled,
    freezeRevoked: r.freezeAuthDisabled,
    top10Pct: r.top10Pct,
    devPct: r.devPct,
    devSoldAll: m ? m.dev_sold_all : null,
    devSelling: m ? m.dev_sells > 0 : null,
    devReport: launch?.dev_report ?? null,
    bundlePct: m ? m.bundle_pct : null,
    earlyPct: r.sniperPct,
    copyOfReal: false,
    sameXAccount: false,
    sameSymbol: false,
    hasSocials: !!(r.twitter || r.telegram || r.website),
    buys1h: r.buys1h,
    sells1h: r.sells1h,
    change5m: r.change5m,
    change1h: r.change1h,
    liquidityUsd: r.liquidityUsd,
    holders: r.holders,
    ageSecs: r.createdAt != null ? nowSecs - r.createdAt : null,
    organicScore: r.organicScore,
    smartHolders: smart,
    verified: r.verified,
  };
}
