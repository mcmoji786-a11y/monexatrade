"use client";
/* Demo perps (gateway perps.rs, migration 0013): long or short with leverage on
   Hyperliquid's live prices, from the demo balance. */
import { GATEWAY_HTTP } from "./gateway";
import { accessToken } from "./account";

export type PerpMarket = { coin: string; mark: number; change_24h_pct: number; funding_hourly: number; max_leverage: number; volume_24h: number; open_interest_usd: number };
export type PerpOpen = {
  id: number;
  coin: string;
  side: "long" | "short";
  leverage: number;
  margin_usd: number;
  size: number;
  entry_px: number;
  mark: number;
  liq_px: number;
  opened_at: string;
  pnl_usd: number;
  pnl_after_costs_usd: number;
  roe_pct: number;
  funding_usd: number;
};
export type PerpClosed = {
  id: number;
  coin: string;
  side: "long" | "short";
  leverage: number;
  margin_usd: number;
  entry_px: number;
  exit_px: number;
  status: "closed" | "liquidated";
  pnl_usd: number;
  fees_usd: number;
  funding_usd: number;
  closed_at: string;
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = accessToken();
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

export const getMarkets = () => call<{ markets: PerpMarket[]; taker_fee: number }>("/perps/markets");
export const getPositions = () => call<{ open: PerpOpen[]; closed: PerpClosed[] }>("/perps/positions");
export const openPerp = (o: { coin: string; side: "long" | "short"; margin_usd: number; leverage: number }) => call<{ entry_px: number; liq_px: number; size: number; fee_usd: number }>("/perps/open", o);
export const closePerp = (id: number) => call<{ exit_px: number; pnl_usd: number }>("/perps/close", { id });

/** The liquidation price, as the gateway computes it (perps.rs liq_price). */
export function liqPrice(side: "long" | "short", entry: number, leverage: number, maxLeverage: number) {
  const mm = 1 / (2 * Math.max(1, maxLeverage));
  return side === "long" ? entry * (1 - 1 / leverage + mm) : entry * (1 + 1 / leverage - mm);
}

/** A price with sensible decimals for anything from SOL to kBONK. */
export function px(v: number) {
  if (!Number.isFinite(v)) return "—";
  const d = v >= 1000 ? 1 : v >= 1 ? 3 : v >= 0.01 ? 5 : 7;
  return v.toLocaleString("en-US", { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
}

export function usdc(v: number, sign = false) {
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : sign ? "+" : ""}$${s}`;
}

export function compact(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
