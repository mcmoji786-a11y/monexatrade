"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { sol, type TradeRow } from "@/lib/gateway";
import { tokenHref } from "@/lib/open-token";
import { TradeLink } from "@/components/token/trade-link";
import { formatAge } from "@/components/radar/use-radar-feed";

export type WalletTrade = { mint: string; symbol: string | null; trade: TradeRow };

/** The button that opens one wallet's trades under its row. */
export function TradesToggle({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-expanded={open}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors ${
        open ? "border-cyan/40 text-cyan" : "border-border text-text-2 hover:bg-surface-2 hover:text-text"
      }`}
    >
      Trades
      <span className="font-mono text-muted">{count}</span>
      <ChevronDown size={13} strokeWidth={1.5} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/** One wallet's trades, newest first, each with a way straight into the coin. */
export function WalletTradesPanel({ trades, now, fresh, symbols }: { trades: WalletTrade[]; now: number; fresh?: Set<string>; symbols?: Record<string, string> }) {
  const buys = trades.filter((t) => t.trade.is_buy);
  const bought = buys.reduce((s, t) => s + t.trade.sol, 0);
  const sold = trades.filter((t) => !t.trade.is_buy).reduce((s, t) => s + t.trade.sol, 0);
  return (
    <div className="fade-up border-t border-border bg-bg/60 px-4 py-3">
      {trades.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">No trades yet on the coins Kixo is tracking. New ones appear here the moment they confirm</p>
      ) : (
        <>
          <p className="mb-2 flex gap-4 font-mono text-[11px] text-muted">
            <span>{trades.length} trades</span>
            <span className="text-positive">bought {sol(bought)}</span>
            <span className="text-negative">sold {sol(sold)}</span>
          </p>
          <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto">
            {trades.map((t) => (
              <li key={t.trade.signature} className={`flex h-10 items-center gap-3 text-sm ${fresh?.has(t.trade.signature) ? "row-in" : ""}`}>
                <span className="w-16 shrink-0 font-mono text-xs text-muted">{now ? `${formatAge(now / 1000 - t.trade.ts)} ago` : "—"}</span>
                <span
                  className={`inline-flex h-5 w-14 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                    t.trade.is_buy ? "border-positive/30 text-positive" : "border-negative/30 text-negative"
                  }`}
                >
                  {t.trade.is_buy ? "Buy" : "Sell"}
                </span>
                <Link href={tokenHref(t.mint)} className="min-w-0 truncate text-text hover:text-cyan">
                  {t.symbol ?? symbols?.[t.mint] ?? `${t.mint.slice(0, 4)}…`}
                </Link>
                <span className="ml-auto font-mono text-text">{sol(t.trade.sol)}</span>
                <span className="hidden w-24 text-right font-mono text-xs text-muted sm:block">MC {t.trade.mc_sol.toFixed(1)} SOL</span>
                <TradeLink mint={t.mint} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
