import { NextResponse } from "next/server";

/* `GET /api/live`: what is happening on Solana right now, for the page's live board and
   ticker. Real coins from Jupiter's token lists (no key): the newest launches and the
   memecoins trending over the last 5 minutes, with the on-chain facts Jupiter audits
   (mint and freeze authority, top 10 holders). Shared by every visitor, refreshed at most
   every 15 seconds. */

const BASE = "https://lite-api.jup.ag/tokens/v2";
const TTL_MS = 15_000;

type Raw = {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  mcap?: number;
  liquidity?: number;
  holderCount?: number;
  launchpad?: string;
  createdAt?: string;
  firstPool?: { createdAt?: string };
  isVerified?: boolean;
  tags?: string[];
  stats5m?: { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number };
  stats1h?: { priceChange?: number };
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number };
};

export type LiveCoin = {
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  mcap: number | null;
  change5m: number | null;
  change1h: number | null;
  holders: number | null;
  /** USD traded in the last 5 minutes, and the buy share of it (0 to 1). */
  vol5m: number;
  buyShare: number | null;
  createdAt: string | null;
  launchpad: string | null;
  mintOff: boolean | null;
  freezeOff: boolean | null;
  top10: number | null;
};

let cache: { at: number; body: { fresh: LiveCoin[]; trending: LiveCoin[]; at: string } } | null = null;

const MAJOR = /^(SOL|WSOL|USDC|USDT|JUP|BTC|CBBTC|WBTC|ETH|WETH|JITOSOL|MSOL|BSOL|JLP|PYUSD|USDS|RAY|BONK)$/i;

/** Anyone can name a coin anything: names with slurs, hate or porn never reach the page.
 *  Matched inside words too, since names are often run together (JewNeegy). */
const BLOCKED = /n[i1e]+gg|neeg|jew(?!el)|kike|nazi|hitler|heil|fag|retard|tranny|chink|(?<!g)rape|porn|nsfw|sex|pussy|dick|(?<!pea)cock|boob|isis|terror|kkk|whore|slut|cunt|holocaust/i;

function clean(r: Raw): LiveCoin | null {
  const symbol = (r.symbol ?? "").trim();
  if (!r.id || !symbol || symbol.length > 14 || !r.icon) return null;
  if (BLOCKED.test(`${symbol} ${r.name ?? ""}`.replace(/[\s_.-]/g, ""))) return null;
  const buy = r.stats5m?.buyVolume ?? 0;
  const sell = r.stats5m?.sellVolume ?? 0;
  return {
    id: r.id,
    symbol,
    name: (r.name ?? symbol).slice(0, 40),
    icon: r.icon ?? null,
    mcap: r.mcap ?? null,
    change5m: r.stats5m?.priceChange ?? null,
    change1h: r.stats1h?.priceChange ?? null,
    holders: r.holderCount ?? null,
    vol5m: buy + sell,
    buyShare: buy + sell > 0 ? buy / (buy + sell) : null,
    createdAt: r.firstPool?.createdAt ?? r.createdAt ?? null,
    launchpad: r.launchpad ?? null,
    mintOff: r.audit?.mintAuthorityDisabled ?? null,
    freezeOff: r.audit?.freezeAuthorityDisabled ?? null,
    // 0 means Jupiter has not measured it yet, not that nobody holds any.
    top10: r.audit?.topHoldersPercentage || null,
  };
}

/** A memecoin: launched on a launchpad (pump.fun and the like), not a major or a stable. */
const isMeme = (r: Raw) => !MAJOR.test(r.symbol ?? "") && (!!r.launchpad || /(pump|bonk|moon|bags)$/i.test(r.id));

async function list(path: string): Promise<Raw[]> {
  const res = await fetch(`${BASE}/${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`jupiter ${res.status}`);
  return (await res.json()) as Raw[];
}

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.body, { headers: { "cache-control": "public, max-age=10" } });
  try {
    const [recent, trending] = await Promise.all([list("recent"), list("toptrending/5m?limit=100")]);
    const fresh = recent
      .filter((r) => (r.holderCount ?? 0) >= 3)
      .map(clean)
      .filter((c): c is LiveCoin => !!c)
      .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))
      .slice(0, 10);
    const hot = trending
      .filter(isMeme)
      .map(clean)
      // Up to $50M: the new and small coins Kixo is about, not project tokens that
      // happen to have launched through a launchpad (MET, META).
      .filter((c): c is LiveCoin => !!c && (c.mcap ?? 0) > 0 && (c.mcap ?? 0) <= 50_000_000)
      .slice(0, 12);
    cache = { at: Date.now(), body: { fresh, trending: hot, at: new Date().toISOString() } };
    return NextResponse.json(cache.body, { headers: { "cache-control": "public, max-age=10" } });
  } catch {
    // Jupiter busy: the last list rather than nothing.
    if (cache) return NextResponse.json(cache.body);
    return NextResponse.json({ fresh: [], trending: [], at: null });
  }
}
