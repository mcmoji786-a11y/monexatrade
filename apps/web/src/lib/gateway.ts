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
  trades_total: number;
  holders: number; // approximate, from observed trades
  top10_pct: number;
  dev_pct: number;
  whale_trades_1h: number;
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
  meta: TokenMeta | null;
  market: Market | null;
};

export type FeedEvent =
  | { type: "snapshot"; sol_usd: number | null; tokens: FeedToken[] }
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
  return `$${v.toFixed(0)}`;
}

/** Tiny token prices: $0.0₅4821 style is hard to read, so use significant digits. */
export function price(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(3)}`;
}
