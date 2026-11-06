"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, RotateCcw } from "lucide-react";
import { orderError, resetDemo, useDemo, type DemoTrade } from "@/lib/demo";
import { pushToast } from "@/lib/toast";
import { compact, money, signed, tinyPrice } from "@/components/trade/trade-panel";

/** The demo account as a portfolio: equity, positions at live prices and every trade. */
export function DemoPortfolio() {
  const { account, trades, error } = useDemo();
  const [allRounds, setAllRounds] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!account) {
    return (
      <div className="flex flex-col gap-6">
        <Title />
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-text-2">{error ? orderError(new Error(error)) : "Loading your demo account…"}</p>
      </div>
    );
  }

  const round = (trades ?? []).filter((t) => t.round === account.round);
  const sells = round.filter((t) => t.side === "sell" && t.realized_usd != null);
  const realized = sells.reduce((a, t) => a + (t.realized_usd ?? 0), 0);
  const wins = sells.filter((t) => (t.realized_usd ?? 0) > 0).length;
  const unrealized = account.positions.reduce((a, p) => a + ((p.value_usd ?? 0) - p.cost_usd), 0);
  const total = account.equity_usd - account.start_usd;
  const fees = round.reduce((a, t) => a + t.fee_usd, 0);
  const volume = round.reduce((a, t) => a + t.usd, 0);
  const best = sells.reduce<DemoTrade | null>((b, t) => (!b || (t.realized_usd ?? 0) > (b.realized_usd ?? 0) ? t : b), null);
  const worst = sells.reduce<DemoTrade | null>((b, t) => (!b || (t.realized_usd ?? 0) < (b.realized_usd ?? 0) ? t : b), null);
  const shown = allRounds ? trades ?? [] : round;

  async function reset() {
    setBusy(true);
    try {
      await resetDemo();
      pushToast({ tone: "info", title: "Demo account reset", body: `Back to ${money(account!.start_usd)}. Past trades are kept` });
    } catch (e) {
      pushToast({ tone: "bad", title: "Reset failed", body: orderError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <Title round={account.round} />
        {confirm ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-2">Close all positions and start again at {money(account.start_usd)}?</span>
            <button type="button" onClick={reset} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg bg-warning px-3 font-medium text-bg disabled:opacity-60">
              {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
              Reset
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="h-9 rounded-lg border border-border px-3 text-text-2 hover:text-text">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
            <RotateCcw size={14} strokeWidth={1.5} />
            Reset account
          </button>
        )}
      </header>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <Stat label="Account value" big value={money(account.equity_usd)} sub={`Started with ${money(account.start_usd)}`} />
        <Stat label="Total P&L" value={signed(total)} tone={total} sub={`${((total / account.start_usd) * 100).toFixed(2)}% this round`} />
        <Stat label="Realized" value={signed(realized)} tone={realized} sub={`${sells.length} closed trades`} />
        <Stat label="Unrealized" value={signed(unrealized)} tone={unrealized} sub={`${account.positions.length} open positions`} />
        <Stat label="Win rate" value={sells.length ? `${Math.round((wins / sells.length) * 100)}%` : "—"} sub={`${wins} wins of ${sells.length}`} />
      </section>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-5">
        <Mini k="Cash" v={money(account.cash_usd)} />
        <Mini k="Volume" v={money(volume)} />
        <Mini k="Fees paid" v={money(fees)} />
        <Mini k="Best trade" v={best?.realized_usd != null ? `${signed(best.realized_usd)} ${best.symbol}` : "—"} tone={best?.realized_usd ?? 0} />
        <Mini k="Worst trade" v={worst?.realized_usd != null ? `${signed(worst.realized_usd)} ${worst.symbol}` : "—"} tone={worst?.realized_usd ?? 0} />
      </section>

      <section className="rounded-xl border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 text-sm font-medium text-text">
          Open positions <span className="ml-1 font-mono text-xs text-muted">{account.positions.length}</span>
        </h2>
        {account.positions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-2">
            No open positions. Open any coin from{" "}
            <Link href="/radar" className="text-text underline underline-offset-2">Sol Radar</Link> or{" "}
            <Link href="/discover" className="text-text underline underline-offset-2">Discover</Link> and buy with demo money
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-2 font-normal">Coin</th>
                  <th className="px-3 py-2 text-right font-normal">Amount</th>
                  <th className="px-3 py-2 text-right font-normal">Avg cost</th>
                  <th className="px-3 py-2 text-right font-normal">Price</th>
                  <th className="px-3 py-2 text-right font-normal">Cost</th>
                  <th className="px-3 py-2 text-right font-normal">Value now</th>
                  <th className="px-3 py-2 text-right font-normal">P&L</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {account.positions.map((p) => {
                  const pnl = p.value_usd != null ? p.value_usd - p.cost_usd : null;
                  return (
                    <tr key={p.mint} className="border-t border-border hover:bg-surface-2">
                      <td className="px-4 py-2.5">
                        <Link href={`/token/${p.mint}`} className="text-text hover:underline">{p.symbol || `${p.mint.slice(0, 4)}…`}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-right text-text">{compact(p.tokens)}</td>
                      <td className="px-3 py-2.5 text-right text-text-2">{tinyPrice(p.cost_usd / p.tokens)}</td>
                      <td className="px-3 py-2.5 text-right text-text-2">{p.price_usd != null ? tinyPrice(p.price_usd) : "No price"}</td>
                      <td className="px-3 py-2.5 text-right text-text-2">{money(p.cost_usd)}</td>
                      <td className="px-3 py-2.5 text-right text-text">{p.value_usd != null ? money(p.value_usd) : "—"}</td>
                      <td className={`px-3 py-2.5 text-right ${tone(pnl)}`}>
                        {pnl == null ? "—" : `${signed(pnl)} (${((pnl / p.cost_usd) * 100).toFixed(1)}%)`}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/token/${p.mint}`} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-2 hover:bg-surface-3 hover:text-text">Trade</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted">Value now is what each position would sell for at this moment, after price impact and fees</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-text">
            Trade history <span className="ml-1 font-mono text-xs text-muted">{shown.length}</span>
          </h2>
          {account.round > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
              <input type="checkbox" checked={allRounds} onChange={(e) => setAllRounds(e.target.checked)} className="accent-emerald" />
              Include earlier rounds
            </label>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-2">No demo trades yet</p>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[860px] text-sm tabular-nums">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-2 font-normal">Time</th>
                  <th className="px-3 py-2 font-normal">Side</th>
                  <th className="px-3 py-2 font-normal">Coin</th>
                  <th className="px-3 py-2 text-right font-normal">Amount</th>
                  <th className="px-3 py-2 text-right font-normal">Price</th>
                  <th className="px-3 py-2 text-right font-normal">Impact</th>
                  <th className="px-3 py-2 text-right font-normal">Fee</th>
                  <th className="px-3 py-2 text-right font-normal">P&L</th>
                  <th className="px-4 py-2 font-normal">By</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-4 py-2 text-xs text-text-2">{new Date(t.ts).toLocaleString()}</td>
                    <td className={`px-3 py-2 text-xs font-medium ${t.side === "buy" ? "text-positive" : "text-negative"}`}>{t.side === "buy" ? "Buy" : "Sell"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/token/${t.mint}`} className="text-text hover:underline">{t.symbol || `${t.mint.slice(0, 4)}…`}</Link>
                    </td>
                    <td className="px-3 py-2 text-right text-text">{money(Number(t.usd))}</td>
                    <td className="px-3 py-2 text-right text-text-2">{tinyPrice(Number(t.price_usd))}</td>
                    <td className={`px-3 py-2 text-right ${Number(t.impact_pct) > 10 ? "text-warning" : "text-text-2"}`}>{Number(t.impact_pct).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right text-text-2">{money(Number(t.fee_usd))}</td>
                    <td className={`px-3 py-2 text-right ${tone(t.realized_usd == null ? null : Number(t.realized_usd))}`}>{t.realized_usd == null ? "—" : signed(Number(t.realized_usd))}</td>
                    <td className="px-4 py-2 text-xs text-muted">{t.source === "sniper" ? "Sniper" : "You"}{allRounds ? ` · round ${t.round + 1}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Title({ round }: { round?: number }) {
  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-medium text-text">
        Portfolio <span className="rounded-md border border-warning/30 px-2 py-0.5 text-xs font-normal text-warning">Demo</span>
      </h1>
      <p className="mt-1 text-sm text-text-2">Virtual money traded at live market prices{round ? ` · round ${round + 1}` : ""}</p>
    </div>
  );
}

function Stat({ label, value, sub, big, tone: t }: { label: string; value: string; sub?: string; big?: boolean; tone?: number }) {
  const color = t == null || t === 0 ? "text-text" : t > 0 ? "text-positive" : "text-negative";
  return (
    <div className="bg-surface px-4 py-4">
      <div className="text-xs text-text-2">{label}</div>
      <div className={`mt-1 font-medium tabular-nums ${big ? "text-3xl text-text" : `text-xl ${color}`}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Mini({ k, v, tone: t }: { k: string; v: string; tone?: number }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-[11px] text-muted">{k}</div>
      <div className={`mt-1 truncate font-mono text-sm tabular-nums ${tone(t ?? null)}`}>{v}</div>
    </div>
  );
}

const tone = (v: number | null) => (v == null || v === 0 ? "text-text" : v > 0 ? "text-positive" : "text-negative");
