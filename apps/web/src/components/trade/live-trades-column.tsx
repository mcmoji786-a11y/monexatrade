"use client";
/* Trade page, wide screens: the coin's trades as they land, in a column next to the chart
   (value, market cap at the trade, wallet, age), so the tape is always in view. A filter
   picks who to show (dev, smart money, whales, early buyers, bundlers). While this column
   is on screen the panel below leaves out its own Trades and Whales tabs, so nothing is
   shown twice. */
import { useState } from "react";
import { shortAddress, usd, type DexTrade, type TradeRow } from "@/lib/gateway";
import type { BookState } from "./use-token-book";
import { openWalletTracker } from "@/lib/tracker";
import { useSmartWallets } from "@/lib/labels";

type Row = { key: string; ts: number; wallet: string; buy: boolean; usd: number | null; mcUsd: number | null; dev: boolean; whale: boolean; sniper: boolean; bundler: boolean };
type Who = "all" | "dev" | "smart" | "whale" | "sniper" | "bundler";
const WHO: { key: Who; label: string }[] = [
  { key: "all", label: "All" },
  { key: "dev", label: "Dev" },
  { key: "smart", label: "Smart" },
  { key: "whale", label: "Whales" },
  { key: "sniper", label: "Early" },
  { key: "bundler", label: "Bundles" },
];

function rows(book: BookState, solUsd: number | null, supply: number | null): Row[] {
  if (book.status === "live") {
    return book.trades.slice(0, 200).map((t: TradeRow) => ({
      key: t.signature,
      ts: t.ts,
      wallet: t.wallet,
      buy: t.is_buy,
      usd: solUsd ? t.sol * solUsd : null,
      mcUsd: solUsd ? t.mc_sol * solUsd : null,
      dev: t.dev,
      whale: t.whale,
      sniper: t.sniper,
      bundler: !!t.bundler,
    }));
  }
  if (book.status === "dex") {
    return book.history.trades.slice(0, 200).map((t: DexTrade) => ({
      key: t.signature,
      ts: t.ts,
      wallet: t.wallet,
      buy: t.is_buy,
      usd: t.usd,
      mcUsd: supply ? t.price_usd * supply : null,
      dev: false,
      whale: solUsd ? t.usd / solUsd >= 5 : false,
      sniper: false,
      bundler: false,
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
  const [who, setWho] = useState<Who>("all");
  const smart = useSmartWallets();
  const all = rows(book, solUsd, supply);
  const list = (who === "all" ? all : all.filter((r) => (who === "smart" ? smart.has(r.wallet) : r[who]))).slice(0, 120);
  return (
    <section aria-label="Live trades" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="no-scrollbar flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-1.5" role="group" aria-label="Show trades by">
        {WHO.map((w) => (
          <button
            key={w.key}
            type="button"
            aria-pressed={who === w.key}
            onClick={() => setWho(w.key)}
            className={`h-6 shrink-0 rounded px-1.5 text-[11px] transition-colors ${who === w.key ? "bg-surface-3 text-text" : "text-muted hover:text-text-2"}`}
          >
            {w.label}
          </button>
        ))}
      </div>
      <div className="grid h-7 shrink-0 grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 border-b border-border px-3 text-[11px] text-muted">
        <span>Value</span>
        <span>MC</span>
        <span>Wallet</span>
        <span className="w-8 text-right">Age</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-muted">{book.status === "loading" ? "Loading trades" : who === "all" ? "No trades yet" : "No trades from these wallets yet"}</li>
        )}
        {list.map((r) => (
          <li key={r.key} className="row-in grid h-6 grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 px-3 font-mono text-[11px] tabular-nums hover:bg-surface-2">
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
              {r.dev && <Tag tone="text-warning border-warning/30">Dev</Tag>}
              {!r.dev && smart.has(r.wallet) && <Tag tone="text-cyan border-cyan/30">S</Tag>}
              {!r.dev && r.whale && <Tag tone="text-text-2 border-border">W</Tag>}
            </span>
            <span className="w-8 text-right text-muted">{now ? age(now / 1000 - r.ts) : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Tag({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`shrink-0 rounded border px-1 font-sans text-[10px] leading-4 ${tone}`}>{children}</span>;
}
