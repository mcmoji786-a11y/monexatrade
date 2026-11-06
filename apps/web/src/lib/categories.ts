import type { FeedToken, MarketToken } from "./gateway";

/** One Discover row, whether it comes from our own launch engine or from the
 *  established-token provider. Fields a source cannot supply are null. */
export type DiscoverRow = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  source: "launch" | "market";
  /** Unix seconds when the token was created, if known. */
  createdAt: number | null;
  priceUsd: number | null;
  mcUsd: number | null;
  liquidityUsd: number | null;
  change5m: number | null;
  change1h: number | null;
  vol5mUsd: number | null;
  vol1hUsd: number | null;
  buys1h: number | null;
  sells1h: number | null;
  holders: number | null;
  holdersApprox: boolean;
  top10Pct: number | null;
  devPct: number | null;
  snipers: number | null;
  sniperPct: number | null;
  verified: boolean;
  /** true: no more tokens can be minted / wallets cannot be frozen. null: unknown. */
  mintAuthDisabled: boolean | null;
  freezeAuthDisabled: boolean | null;
  /** Provider's 0-100 estimate of how much volume comes from real traders. */
  organicScore: number | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};

function fromLaunch(t: FeedToken, solUsd: number | null): DiscoverRow | null {
  const m = t.market;
  if (!m || !m.sol_quoted) return null;
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    image: t.meta?.image ?? null,
    source: "launch",
    createdAt: t.timestamp,
    priceUsd: m.price_usd,
    mcUsd: m.mc_usd,
    liquidityUsd: null,
    change5m: m.change_5m_pct,
    change1h: m.change_1h_pct,
    vol5mUsd: solUsd ? m.volume_5m_sol * solUsd : null,
    vol1hUsd: m.volume_1h_usd,
    buys1h: m.buys_1h,
    sells1h: m.sells_1h,
    holders: m.holders,
    holdersApprox: true,
    top10Pct: m.top10_pct,
    devPct: m.dev_pct,
    snipers: m.snipers,
    sniperPct: m.sniper_pct,
    verified: false,
    // pump.fun revokes both authorities at creation; other launchpads: see provider.
    mintAuthDisabled: t.launchpad === "pump.fun" ? true : null,
    freezeAuthDisabled: t.launchpad === "pump.fun" ? true : null,
    organicScore: null,
    twitter: t.meta?.twitter ?? null,
    telegram: t.meta?.telegram ?? null,
    website: t.meta?.website ?? null,
  };
}

function fromMarket(t: MarketToken): DiscoverRow {
  const created = t.created_at ? Date.parse(t.created_at) / 1000 : NaN;
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    image: t.image,
    source: "market",
    createdAt: Number.isFinite(created) ? created : null,
    priceUsd: t.price_usd,
    mcUsd: t.mc_usd,
    liquidityUsd: t.liquidity_usd,
    change5m: t.change_5m_pct,
    change1h: t.change_1h_pct,
    vol5mUsd: t.volume_5m_usd,
    vol1hUsd: t.volume_1h_usd,
    buys1h: t.buys_1h,
    sells1h: t.sells_1h,
    holders: t.holders,
    holdersApprox: false,
    top10Pct: t.top_holders_pct,
    devPct: null,
    snipers: null,
    sniperPct: null,
    verified: t.verified,
    mintAuthDisabled: t.mint_authority_disabled,
    freezeAuthDisabled: t.freeze_authority_disabled,
    organicScore: t.organic_score,
    twitter: t.twitter,
    telegram: t.telegram,
    website: t.website,
  };
}

/** Our curve price is fresher than the provider's (it updates on every trade; the
 *  provider lags ~10 s, measured avg gap 9.3% on fast movers, 2026-11-06), so it wins
 *  unless the two are wildly apart. A gap over 5x means the token also trades outside
 *  its curve (verified case: XTO, ~500x apart), and the provider's market-wide
 *  figures are used instead. */
const PRICE_MISMATCH_RATIO = 5;

/** Merge both sources. Our own launch data wins on price and flow (it updates on every
 *  trade, and matched Jupiter within 0.5% for 17 of 20 tokens checked on 2026-11-06).
 *  The provider supplies exact holders, liquidity and verification, which our
 *  trade-based holder estimate cannot match (it over-counted on fresh tokens). */
function merge(own: DiscoverRow, other: DiscoverRow): DiscoverRow {
  const merged: DiscoverRow = {
    ...own,
    liquidityUsd: other.liquidityUsd,
    verified: other.verified,
    mintAuthDisabled: other.mintAuthDisabled ?? own.mintAuthDisabled,
    freezeAuthDisabled: other.freezeAuthDisabled ?? own.freezeAuthDisabled,
    organicScore: other.organicScore,
    holders: other.holders ?? own.holders,
    holdersApprox: other.holders == null,
    // Our launch metadata first, the provider's links when the launch has none.
    twitter: own.twitter ?? other.twitter,
    telegram: own.telegram ?? other.telegram,
    website: own.website ?? other.website,
  };
  const ratio = own.priceUsd && other.priceUsd ? own.priceUsd / other.priceUsd : 1;
  if (ratio > PRICE_MISMATCH_RATIO || ratio < 1 / PRICE_MISMATCH_RATIO) {
    return { ...merged, priceUsd: other.priceUsd, mcUsd: other.mcUsd, change5m: other.change5m, change1h: other.change1h };
  }
  return merged;
}

export function buildRows(tokens: FeedToken[], markets: Record<string, MarketToken>, solUsd: number | null) {
  const rows = new Map<string, DiscoverRow>();
  for (const t of Object.values(markets)) rows.set(t.mint, fromMarket(t));
  for (const t of tokens) {
    const own = fromLaunch(t, solUsd);
    if (!own) continue;
    const other = rows.get(t.mint);
    rows.set(t.mint, other ? merge(own, other) : own);
  }
  return [...rows.values()];
}

/** Which figure a category is ranked by (highlighted in the UI). */
export type MetricKey = "volume5m" | "change1h" | "snipers" | "trades" | "risk";

export type Category = {
  key: string;
  label: string;
  description: string;
  metric: MetricKey;
  include: (r: DiscoverRow) => boolean;
  /** Higher ranks first. */
  score: (r: DiscoverRow) => number;
};

/** Top gainers follow the filters large Solana screeners apply, so a handful of trades
 *  on a thin coin cannot top the list:
 *  - at least an hour old (younger coins compare against their launch price, which
 *    turns every new launch into a +500% "gainer")
 *  - real size: market cap, hourly volume and holders over a floor
 *  - liquidity over a floor when known (pump.fun curve coins report none) */
const GAINER = { minAgeSecs: 3_600, minMcUsd: 50_000, minVol1hUsd: 10_000, minHolders: 200, minLiquidityUsd: 10_000 };

function isGainerCandidate(r: DiscoverRow) {
  const age = r.createdAt != null ? Date.now() / 1000 - r.createdAt : Infinity;
  return (
    (r.change1h ?? 0) > 0 &&
    age >= GAINER.minAgeSecs &&
    (r.mcUsd ?? 0) >= GAINER.minMcUsd &&
    (r.vol1hUsd ?? 0) >= GAINER.minVol1hUsd &&
    (r.holders ?? 0) >= GAINER.minHolders &&
    (r.liquidityUsd == null || r.liquidityUsd >= GAINER.minLiquidityUsd)
  );
}

/** Lower risk: every check below must pass on facts we can see. Unknown counts as a
 *  fail, so a coin is never listed for lack of data. This is a filter of red flags,
 *  not a promise: any memecoin can still lose its value.
 *  Not yet included: the creator's history across earlier coins (needs our own
 *  creator index, planned). */
const LOWER_RISK = {
  minAgeSecs: 6 * 3_600,
  minMcUsd: 100_000,
  minLiquidityUsd: 25_000,
  minHolders: 500,
  minVol1hUsd: 5_000,
  maxTop10Pct: 25,
  maxDevPct: 5,
  maxEarlyBuyerPct: 5,
  minOrganicScore: 50,
  minChange1hPct: -20,
};

/** Red-flag points from a row alone, 0 (none) to 100. Same factors as the trade page's
 *  risk badge (risk.ts), limited to what a list row knows. */
export function rowRisk(r: DiscoverRow) {
  let s = 0;
  if (r.mintAuthDisabled === false) s += 30;
  if (r.freezeAuthDisabled === false) s += 20;
  const top10 = r.top10Pct ?? 0;
  s += top10 > 50 ? 25 : top10 > 30 ? 12 : top10 > 15 ? 4 : 0;
  const dev = r.devPct ?? 0;
  s += dev > 20 ? 20 : dev > 10 ? 10 : dev > 2 ? 3 : 0;
  const early = r.sniperPct ?? 0;
  s += early > 15 ? 15 : early > 5 ? 7 : 0;
  const buys = r.buys1h ?? 0;
  const sells = r.sells1h ?? 0;
  if (buys + sells >= 20 && sells > buys * 1.5) s += 10;
  if ((r.liquidityUsd ?? Infinity) < 5_000) s += 8;
  if (r.organicScore != null && r.organicScore < 50) s += 10;
  return Math.min(100, s);
}

function isLowerRisk(r: DiscoverRow) {
  const L = LOWER_RISK;
  const age = r.createdAt != null ? Date.now() / 1000 - r.createdAt : -1;
  return (
    r.mintAuthDisabled === true &&
    r.freezeAuthDisabled === true &&
    age >= L.minAgeSecs &&
    (r.mcUsd ?? 0) >= L.minMcUsd &&
    (r.liquidityUsd ?? 0) >= L.minLiquidityUsd &&
    (r.holders ?? 0) >= L.minHolders &&
    (r.vol1hUsd ?? 0) >= L.minVol1hUsd &&
    r.top10Pct != null &&
    r.top10Pct <= L.maxTop10Pct &&
    (r.devPct ?? 0) <= L.maxDevPct &&
    (r.sniperPct ?? 0) <= L.maxEarlyBuyerPct &&
    (r.organicScore ?? 0) >= L.minOrganicScore &&
    (r.change1h ?? 0) >= L.minChange1hPct
  );
}

export const CATEGORIES: Category[] = [
  {
    key: "trending",
    label: "Trending",
    description: "Most traded across Solana in the last 5 minutes",
    metric: "volume5m",
    include: (r) => (r.vol5mUsd ?? 0) > 0,
    score: (r) => r.vol5mUsd ?? 0,
  },
  {
    key: "gainers",
    label: "Top gainers",
    description: "Biggest 1h price rise among Solana memecoins over an hour old, with $50K+ market cap, $10K+ hourly volume and 200+ holders",
    metric: "change1h",
    include: isGainerCandidate,
    score: (r) => r.change1h ?? 0,
  },
  {
    key: "sniped",
    label: "Sniped",
    description: "New launches bought by other wallets within 3 seconds, ranked by the share they still hold",
    metric: "snipers",
    include: (r) => (r.snipers ?? 0) > 0,
    score: (r) => (r.sniperPct ?? 0) * 1e3 + (r.snipers ?? 0),
  },
  {
    key: "active",
    label: "Most active",
    description: "Most buys and sells across Solana in the last hour",
    metric: "trades",
    include: (r) => (r.buys1h ?? 0) + (r.sells1h ?? 0) > 0,
    score: (r) => (r.buys1h ?? 0) + (r.sells1h ?? 0),
  },
  {
    key: "lower-risk",
    label: "Lower risk",
    description:
      "Passed every red-flag check: mint and freeze revoked, 6h+ old, $100K+ market cap, $25K+ liquidity, 500+ holders, top 10 under 25%, dev and early buyers under 5%, organic trading. Fewer red flags, not a guarantee",
    metric: "risk",
    include: isLowerRisk,
    // Fewest red flags first, then the most traded.
    score: (r) => (100 - rowRisk(r)) * 1e9 + (r.vol1hUsd ?? 0),
  },
];

export function rank(rows: DiscoverRow[], cat: Category) {
  return rows.filter(cat.include).sort((a, b) => cat.score(b) - cat.score(a));
}
