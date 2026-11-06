"use client";

import { useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
import { CopyAddress } from "@/components/token/token-bits";
import { usd, type TradeRow } from "@/lib/gateway";
import { formatAge } from "@/components/radar/use-radar-feed";
import type { BookState } from "./use-token-book";

type Kind = "dev" | "whale" | "early";
const KINDS: Record<Kind, { label: string; tone: string; dot: string; about: string }> = {
  dev: { label: "Dev", tone: "text-warning", dot: "bg-warning", about: "The creator of the coin buying or selling" },
  whale: { label: "Whales", tone: "text-cyan", dot: "bg-cyan", about: "A single trade of 5 SOL or more" },
  early: { label: "Early buyers", tone: "text-negative", dot: "bg-negative", about: "Wallets that bought in the first 3 seconds, now selling" },
};

/** Which big move a trade is, if any. Dev wins over whale, whale over early buyer. */
export function kindOf(t: TradeRow): Kind | null {
  if (t.dev) return "dev";
  if (t.whale) return "whale";
  if (t.sniper && !t.is_buy) return "early";
  return null;
}

/** Header button that opens every big move on this coin. */
export function BigMovesButton({ book, solUsd, now }: { book: BookState; solUsd: number | null; now: number }) {
  const [open, setOpen] = useState(false);
  const moves = book.status === "live" ? book.trades.filter((t) => kindOf(t) != null) : [];
  const latest = moves[0];
  const fresh = latest && now / 1000 - latest.ts < 60;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={book.status !== "live"}
        className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs text-text-2 transition-colors hover:border-emerald/40 hover:text-text focus-visible:outline-2 focus-visible:outline-emerald disabled:opacity-50"
      >
        <span className="relative flex">
          <Activity size={14} strokeWidth={1.5} />
          {fresh && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald" />}
        </span>
        Big moves
        <span className="font-mono text-muted">{moves.length}</span>
      </button>
      {open && book.status === "live" && <BigMovesDialog moves={moves} solUsd={solUsd} now={now} onClose={() => setOpen(false)} />}
    </>
  );
}

function BigMovesDialog({ moves, solUsd, now, onClose }: { moves: TradeRow[]; solUsd: number | null; now: number; onClose: () => void }) {
  const [filter, setFilter] = useState<Kind | "all">("all");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const money = (sol: number) => (solUsd ? usd(sol * solUsd) : `${sol.toFixed(2)} SOL`);
  const shown = filter === "all" ? moves : moves.filter((t) => kindOf(t) === filter);

  // Totals per kind: buys and sells in SOL.
  const sum = (k: Kind, buy: boolean) => moves.filter((t) => kindOf(t) === k && t.is_buy === buy).reduce((a, t) => a + t.sol, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="big-moves-title"
        onClick={(e) => e.stopPropagation()}
        className="fade-up flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 id="big-moves-title" className="text-base font-medium text-text">
              Big moves
            </h2>
            <p className="mt-1 text-sm text-text-2">Trades worth watching on this coin, straight from the blockchain</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* What each kind means, with its totals */}
        <div className="grid gap-px border-b border-border bg-border sm:grid-cols-3">
          {(Object.keys(KINDS) as Kind[]).map((k) => (
            <div key={k} className="bg-surface p-4">
              <div className={`flex items-center gap-2 text-sm ${KINDS[k].tone}`}>
                <span className={`h-2 w-2 rounded-full ${KINDS[k].dot}`} />
                {KINDS[k].label}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">{KINDS[k].about}</p>
              <div className="mt-2 flex gap-4 font-mono text-xs">
                <span className="text-positive">Bought {money(sum(k, true))}</span>
                <span className="text-negative">Sold {money(sum(k, false))}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-1 border-b border-border px-3 py-2">
          {(["all", "dev", "whale", "early"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`h-8 rounded-md px-3 text-sm transition-colors ${filter === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
            >
              {k === "all" ? "All" : KINDS[k].label}
              <span className="ml-1.5 font-mono text-[11px] text-muted">
                {k === "all" ? moves.length : moves.filter((t) => kindOf(t) === k).length}
              </span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted">None yet. They appear here the moment they happen</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="h-9 border-b border-border text-left text-muted">
                  <th className="pl-5 font-normal">Age</th>
                  <th className="font-normal">Who</th>
                  <th className="font-normal">Action</th>
                  <th className="text-right font-normal">Amount</th>
                  <th className="text-right font-normal">MC at trade</th>
                  <th className="pl-6 font-normal">Wallet</th>
                  <th className="pr-5 text-right font-normal">Tx</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {shown.map((t) => {
                  const k = kindOf(t)!;
                  return (
                    <tr key={t.signature + t.wallet} className="h-10 border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="pl-5 text-muted">{formatAge(now / 1000 - t.ts)}</td>
                      <td>
                        <span className={`flex items-center gap-2 font-sans ${KINDS[k].tone}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${KINDS[k].dot}`} />
                          {k === "early" ? "Early buyer" : k === "whale" ? "Whale" : "Dev"}
                        </span>
                      </td>
                      <td className={t.is_buy ? "text-positive" : "text-negative"}>{t.is_buy ? "Bought" : "Sold"}</td>
                      <td className="text-right text-text">
                        {money(t.sol)}
                        <span className="ml-1.5 text-muted">{t.sol.toFixed(2)} SOL</span>
                      </td>
                      <td className="text-right text-text-2">{solUsd ? usd(t.mc_sol * solUsd) : `${t.mc_sol.toFixed(1)} SOL`}</td>
                      <td className="pl-6">
                        {t.wallet ? (
                          <CopyAddress value={t.wallet} title={`Copy wallet ${t.wallet}`} className="text-cyan" />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="pr-5 text-right">
                        <span className="inline-flex justify-end">
                          <CopyAddress value={t.signature} title="Copy transaction signature" className="text-muted" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
