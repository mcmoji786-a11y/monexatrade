"use client";
/* Trade page, wide screens: the coin's trades as they land, in a narrow column next to
   the chart (value, market cap at the trade, wallet, age), so the tape is always in view.
   The full list with filters stays in the Trades tab below. */
import { shortAddress, usd, type DexTrade, type TradeRow } from "@/lib/gateway";
import type { BookState } from "./use-token-book";
import { openWalletTracker } from "@/lib/tracker";

type Row = { key: string; ts: number; wallet: string; buy: boolean; usd: number | null; mcUsd: number | null; dev: boolean };

function rows(book: BookState, solUsd: number | null, supply: number | null): Row[] {
  if (book.status === "live") {
    return book.trades.slice(0, 80).map((t: TradeRow) => ({
      key: t.signature,
      ts: t.ts,
      wallet: t.wallet,
      buy: t.is_buy,
      usd: solUsd ? t.sol * solUsd : null,
      mcUsd: solUsd ? t.mc_sol * solUsd : null,
      dev: t.dev,
    }));
  }
  if (book.status === "dex") {
    return book.history.trades.slice(0, 80).map((t: DexTrade) => ({
      key: t.signature,
      ts: t.ts,
      wallet: t.wallet,
      buy: t.is_buy,
      usd: t.usd,
      mcUsd: supply ? t.price_usd * supply : null,
      dev: false,
    }));
  }
  return [];
}

function age(secs: number) {
  if (secs < 60) return `${Math.max(0, Math.floor(secs))}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export function LiveTradesColumn({ book, solUsd, supply, now }: { book: BookState; solUsd: number | null; supply: number | null; now: number }) {
  const list = rows(book, solUsd, supply);
  return (
    <section aria-label="Live trades" className="flex h-full min-h-0 flex-col border-l border-border bg-surface">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 border-b border-border px-3 py-2 text-xs text-muted">
        <span>Value</span>
        <span>MC</span>
        <span>Wallet</span>
        <span className="w-8 text-right">Age</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">{book.status === "loading" ? "Loading trades" : "No trades yet"}</li>}
        {list.map((r) => (
          <li key={r.key} className="row-in grid h-7 grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 px-3 font-mono text-xs tabular-nums hover:bg-surface-2">
            <span className={r.buy ? "text-positive" : "text-negative"}>{r.usd == null ? "—" : usd(r.usd)}</span>
            <span className="text-text-2">{r.mcUsd == null ? "—" : usd(r.mcUsd)}</span>
            <span className="flex min-w-0 items-center gap-1">
              {r.wallet ? (
                <button type="button" onClick={() => openWalletTracker(r.wallet)} title={`Open ${r.wallet} in the Wallet Tracker`} className="truncate text-text-2 hover:text-text hover:underline">
                  {shortAddress(r.wallet)}
                </button>
              ) : (
                <span className="text-muted">—</span>
              )}
              {r.dev && <span className="rounded border border-warning/30 px-1 font-sans text-[10px] leading-4 text-warning">Dev</span>}
            </span>
            <span className="w-8 text-right text-muted">{now ? age(now / 1000 - r.ts) : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
