"use client";
/* One notification for every filled trade (trade ticket, Instant, Quick Buy), buy or sell:
   the trade card for the toaster's premium layout, and the share card one click away. */
import { pushToast, type TradeNote } from "./toast";
import { openShareCard, type ShareTrade } from "./share";
import type { DemoTrade } from "./demo";

export type Filled = {
  venue: "demo" | "real";
  side: "buy" | "sell";
  mint: string;
  symbol: string;
  usd: number | null;
  sol: number;
  tokens: number | null;
  priceUsd: number | null;
  feeUsd: number | null;
  /** Sells: profit in USD (demo). */
  realizedUsd: number | null;
  impactPct?: number | null;
  /** When the position was opened (sells), for the card's "Held". */
  openedAt?: string | null;
  source?: DemoTrade["source"];
};

export function tradeToast(f: Filled) {
  const pnl = f.side === "sell" && f.realizedUsd != null ? f.realizedUsd : null;
  const cost = pnl != null && f.usd != null ? f.usd - pnl : null;
  const pnlPct = pnl != null && cost && cost > 0 ? (pnl / cost) * 100 : null;
  const trade: TradeNote = { side: f.side, venue: f.venue, symbol: f.symbol, mint: f.mint, usd: f.usd, sol: f.sol, tokens: f.tokens, priceUsd: f.priceUsd, feeUsd: f.feeUsd, pnl, pnlPct };
  // The share card shows demo results (labelled as such); real trades have no card yet.
  const card: ShareTrade | null =
    f.venue === "demo" && f.usd != null && f.tokens && f.priceUsd != null
      ? {
          id: Math.round(f.tokens) + Math.round(f.usd * 100),
          mint: f.mint,
          symbol: f.symbol,
          side: f.side,
          tokens: f.tokens,
          usd: f.usd,
          sol: f.sol,
          price_usd: f.priceUsd,
          fee_usd: f.feeUsd ?? 0,
          impact_pct: f.impactPct ?? 0,
          source: f.source ?? "manual",
          realized_usd: f.realizedUsd,
          round: 0,
          ts: new Date().toISOString(),
          openedAt: f.openedAt ?? null,
        }
      : null;
  pushToast({
    kind: "trade",
    tone: pnl != null && pnl < 0 ? "bad" : "good",
    title: `${f.side === "buy" ? "Bought" : "Sold"} ${f.symbol || "coin"} · ${f.venue}`,
    trade,
    action: card ? { label: "View card", onClick: () => openShareCard(card) } : undefined,
  });
}
