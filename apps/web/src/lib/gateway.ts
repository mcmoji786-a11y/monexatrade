export const GATEWAY_HTTP = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";
export const GATEWAY_WS = GATEWAY_HTTP.replace(/^http/, "ws");

/** Creator-supplied, off-chain metadata. URLs are validated as https by the gateway. */
export type TokenMeta = {
  image: string | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};

/** Mirrors `monexa_ingest::market::MarketSnapshot`, computed from our own decoders. */
export type Market = {
  mint: string;
  /** false: curve trades against another currency; USD figures are null. */
  sol_quoted: boolean;
  price_sol: number;
  price_usd: number | null;
  mc_sol: number;
  mc_usd: number | null;
  curve_progress: number; // 0..100
  complete: boolean;
  volume_5m_sol: number;
  volume_1h_sol: number;
  volume_1h_usd: number | null;
  buys_1h: number;
  sells_1h: number;
  /** SOL bought minus SOL sold, last hour. */
  net_buy_1h_sol: number;
  trades_total: number;
  holders: number; // approximate, from observed trades
  top10_pct: number;
  dev_pct: number;
  /** Sells by the creator since launch, and whether it sold all it bought. */
  dev_sells: number;
  dev_sold_all: boolean;
  /** Wallets that bought together in one slot right after launch, and their share. */
  bundled: number;
  bundle_pct: number;
  /** Holders now minus about an hour ago (or launch). */
  holders_change_1h: number;
  whale_trades_1h: number;
  /** Buys of 5 SOL or more in the last hour. */
  whale_buys_1h: number;
  /** Price change; tokens younger than the window compare against launch price. */
  change_5m_pct: number | null;
  change_1h_pct: number | null;
  /** Wallets (not the creator) that bought within 3 s of launch, and what they still hold. */
  snipers: number;
  sniper_pct: number;
  last_trade: number;
};

/** Mirrors the gateway's `FeedToken` (Rust). */
export type FeedToken = {
  signature: string;
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bonding_curve: string;
  creator: string;
  timestamp: number; // unix seconds, on-chain
  standard: "Spl" | "Token2022";
  /** "pump.fun", "letsbonk.fun", "bags", "met-dbc", "raydium-launchlab", "moonshot" or "other". */
  launchpad: string;
  meta: TokenMeta | null;
  market: Market | null;
  /** The creator's earlier coins since our engine started tracking. */
  dev_report?: DevReport | null;
};

export type DevReport = { coins: number; graduated: number; rugged: number; died_fast: number; best_peak_mc_usd: number | null };

/** Established token across Solana, from the gateway's Jupiter provider (ADR 0004). */
export type MarketToken = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  price_usd: number | null;
  mc_usd: number | null;
  liquidity_usd: number | null;
  holders: number | null;
  change_5m_pct: number | null;
  change_1h_pct: number | null;
  change_24h_pct: number | null;
  volume_5m_usd: number | null;
  volume_1h_usd: number | null;
  volume_24h_usd: number | null;
  buys_1h: number | null;
  sells_1h: number | null;
  traders_1h: number | null;
  top_holders_pct: number | null;
  mint_authority_disabled: boolean;
  freeze_authority_disabled: boolean | null;
  verified: boolean;
  organic_score: number | null;
  launchpad: string | null;
  created_at: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};

export type FeedEvent =
  | { type: "snapshot"; sol_usd: number | null; tokens: FeedToken[]; markets?: MarketToken[]; sparks?: Record<string, number[]>; smart?: Record<string, number> }
  | { type: "smart"; counts: Record<string, number> }
  | { type: "markets"; items: MarketToken[] }
  | { type: "markets_removed"; mints: string[] }
  | { type: "token"; token: FeedToken }
  | { type: "meta"; mint: string; meta: TokenMeta }
  | { type: "market"; sol_usd: number | null; items: Market[] }
  | { type: "removed"; mints: string[] };

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** $1.2K, $34.5K, $1.20M. One format everywhere. */
export function usd(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (v >= 10 || v <= 0) return `$${v.toFixed(0)}`;
  // Small trades: cents matter, and a real trade never reads as $0.
  if (v >= 0.01) return `$${v.toFixed(2)}`;
  return "<$0.01";
}

/** +12.3% / −4.0%. One format everywhere. */
export function pct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s = abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : abs.toFixed(abs >= 100 ? 0 : 1);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}%`;
}

/** Tiny token prices: $0.0₅4821 style is hard to read, so use significant digits. */
export function price(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return `$${v.toFixed(2)}`;
  // Three significant digits without scientific notation ($0.000000713, not $7.13e-7).
  return `$${v.toFixed(Math.min(20, Math.ceil(-Math.log10(v)) + 2))}`;
}

/** Trade page data from the gateway's trade book (`book.rs`), pump.fun launches only. */
export type TradeRow = {
  signature: string;
  ts: number;
  wallet: string;
  is_buy: boolean;
  sol: number;
  tokens: number;
  price_sol: number;
  mc_sol: number;
  whale: boolean;
  dev: boolean;
  sniper: boolean;
  /** Bought in a launch bundle (missing on DEX trades). */
  bundler?: boolean;
};

/** OHLC of market cap in SOL, volume in SOL. */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

/** `source`: "curve" (pump.fun bonding curve) or the DEX of the live pool ("pumpswap", "raydium", "orca", "meteora"). */
/** `whales`: trades of 5 SOL or more, newest first, kept even after they leave `trades`. */
export type BookSnapshot = { source: string; pool: string | null; trades: TradeRow[]; candles: Candle[]; candle_secs: number; supply: number; whales?: TradeRow[] };

export type Position = {
  wallet: string;
  buys: number;
  sells: number;
  bought_sol: number;
  sold_sol: number;
  bought_tokens: number;
  sold_tokens: number;
  balance: number;
  pct: number;
  realized_sol: number;
  value_sol: number;
  first_ts: number;
  last_ts: number;
  dev: boolean;
  sniper: boolean;
  bundler?: boolean;
  /** Made a single buy of 5 SOL or more. */
  big_buyer?: boolean;
};

export type Wallets = {
  holders: Position[];
  top_traders: Position[];
  /** Biggest buyers and sellers by SOL (newer gateways). */
  top_buyers?: Position[];
  top_sellers?: Position[];
  /** Every trader of the coin, summed. */
  trader_stats?: { traders: number; in_profit: number; bought_sol: number; sold_sol: number; best_pnl_sol: number };
  dev: Position | null;
  snipers: Position[];
  holder_count: number;
  focus: Position | null;
};

/** Profit in SOL: realised plus the remaining balance at today's price, minus what it cost. */
export function positionPnl(p: Position) {
  const costSold = p.bought_tokens > 0 ? (p.bought_sol / p.bought_tokens) * Math.min(p.sold_tokens, p.bought_tokens) : 0;
  return p.realized_sol + p.value_sol - (p.bought_sol - costSold);
}

export function sol(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return `${v < 0 ? "−" : ""}${a >= 1000 ? `${(a / 1000).toFixed(1)}K` : a >= 1 ? a.toFixed(2) : a.toFixed(3)} SOL`;
}

export function amount(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

/** Tokens outside our decoder: the main Solana DEX pool via GeckoTerminal (`dex.rs`). */
export type DexTrade = { signature: string; ts: number; wallet: string; is_buy: boolean; usd: number; tokens: number; price_usd: number };
export type DexHistory = {
  pool: { address: string; name: string; dex: string | null };
  candle_secs: number;
  /** USD price OHLC, USD volume. */
  candles: Candle[];
  trades: DexTrade[];
};
