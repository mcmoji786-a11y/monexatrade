"use client";
/* The Wallet Tracker's report, in plain words: one line on what this wallet does, badges
   that each say why they apply, profit day by day, and its best and worst coins. Every
   number has a one-line explanation on hover, for people new to trading. */
import Link from "next/link";
import { Info } from "lucide-react";
import { span, type Badge, type CoinResult, type WalletReport } from "@/lib/wallet-report";
import { tokenHref } from "@/lib/open-token";
import { shortAddress } from "@/lib/gateway";

const solTxt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 3 })} SOL`;
const usdTxt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })}`;

/** A small (i) that explains a figure on hover or focus. */
export function Explain({ text }: { text: string }) {
  return (
    <span tabIndex={0} title={text} aria-label={text} className="inline-flex cursor-help text-muted outline-none hover:text-text-2 focus-visible:text-text">
      <Info size={11} strokeWidth={1.5} />
    </span>
  );
}

const TONE: Record<Badge["tone"], string> = {
  good: "border-positive/30 text-positive",
  bad: "border-negative/30 text-negative",
  info: "border-border text-text-2",
};

/** The line on what this wallet does, and its badges. */
export function WalletSummary({ r, source }: { r: WalletReport; source: string }) {
  return (
    <section className="rounded-xl border border-border bg-bg/40 p-4">
      <p className="flex items-center gap-1.5 text-xs text-text-2">
        In short
        <Explain text={`Written by Kixo from ${source}, with fixed rules, not guesses. Each badge says why it applies`} />
      </p>
      <p className="mt-1.5 text-[15px] leading-6 text-text">{r.summary}</p>
      {r.badges.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {r.badges.map((b) => (
            <li key={b.key} title={b.why} tabIndex={0} className={`cursor-help rounded-md border px-2 py-0.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-text-2 ${TONE[b.tone]}`}>
              {b.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Profit by day, how it trades, and its best and worst coins. */
export function WalletPerformance({ r, solUsd, compact, days }: { r: WalletReport; solUsd: number | null; compact: boolean; days: number }) {
  if (!r.trades) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-text">
          Profit by day
          <Explain text="Profit or loss on the coins it sold each day, against what it paid for them. Coins still held are not counted here" />
        </h3>
        <span className={`font-mono text-sm tabular-nums ${r.realizedSol > 0 ? "text-positive" : r.realizedSol < 0 ? "text-negative" : "text-text-2"}`}>
          {r.scored ? solTxt(r.realizedSol) : "—"}
          {r.scored && solUsd ? <span className="ml-2 text-xs text-muted">{usdTxt(r.realizedSol * solUsd)}</span> : null}
        </span>
      </div>
      <DailyBars daily={r.daily} days={days} />

      <dl className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
        <Fig k="Return" v={r.roiPct != null ? `${r.roiPct >= 0 ? "+" : "−"}${Math.abs(r.roiPct).toFixed(0)}%` : "—"} tone={r.roiPct == null ? undefined : r.roiPct >= 0 ? "good" : "bad"} why="Profit on the coins it sold, as a share of what those coins cost it" />
        <Fig k="Usual hold" v={r.medianHoldSecs != null ? span(r.medianHoldSecs) : "—"} why="Typical time from buying a coin to selling it (the middle value, so one long hold does not skew it)" />
        <Fig k="Average buy" v={r.avgBuySol != null ? `${r.avgBuySol.toFixed(r.avgBuySol >= 10 ? 1 : 2)} SOL` : "—"} why="How much SOL it usually spends on one buy" />
        <Fig k="Pace" v={r.perHour != null ? (r.perHour >= 1 ? `${Math.round(r.perHour)}/h` : `${r.trades} swaps`) : "—"} why="Swaps per hour, counted from its first to its last swap in this period" />
      </dl>

      {(r.best.length > 0 || r.worst.length > 0) && (
        <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
          <CoinList title="Best coins" list={r.best} solUsd={solUsd} />
          <CoinList title="Worst coins" list={r.worst} solUsd={solUsd} />
        </div>
      )}
    </section>
  );
}

function Fig({ k, v, why, tone }: { k: string; v: string; why: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
      <dt className="flex items-center gap-1 text-xs text-text-2">
        {k}
        <Explain text={why} />
      </dt>
      <dd className={`mt-0.5 font-mono text-base tabular-nums ${tone === "good" ? "text-positive" : tone === "bad" ? "text-negative" : "text-text"}`}>{v}</dd>
    </div>
  );
}

/** One bar a day around a zero line: green above for profit, red below for loss. */
function DailyBars({ daily, days }: { daily: { day: string; sol: number }[]; days: number }) {
  const max = Math.max(...daily.map((d) => Math.abs(d.sol)), 0);
  const h = 64;
  if (max === 0) return <p className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">No sales with a known buy price in the last {days} days</p>;
  const w = 100 / daily.length;
  return (
    <div>
      <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="h-16 w-full" role="img" aria-label={`Profit by day, last ${days} days`}>
        <line x1="0" x2="100" y1={h / 2} y2={h / 2} stroke="currentColor" className="text-border" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {daily.map((d, i) => {
          if (!d.sol) return null;
          const bh = Math.max(1, (Math.abs(d.sol) / max) * (h / 2 - 2));
          return (
            <rect key={d.day} x={i * w + w * 0.15} width={w * 0.7} y={d.sol > 0 ? h / 2 - bh : h / 2} height={bh} rx="0.4" className={d.sol > 0 ? "fill-positive/80" : "fill-negative/80"}>
              <title>{`${d.day}: ${solTxt(d.sol)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-xs text-muted">
        <span>{daily[0]?.day.slice(5)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function CoinList({ title, list, solUsd }: { title: string; list: CoinResult[]; solUsd: number | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-xs text-text-2">{title}</p>
      {list.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted">None</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((c) => (
            <li key={c.mint}>
              <Link href={tokenHref(c.mint)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-text">{c.symbol || shortAddress(c.mint)}</span>
                {c.holdSecs != null && <span className="font-mono text-xs text-muted">held {span(c.holdSecs)}</span>}
                <span className={`w-24 text-right font-mono text-xs tabular-nums ${(c.realizedSol ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                  {solTxt(c.realizedSol ?? 0)}
                  {solUsd ? <span className="block text-xs text-muted">{usdTxt((c.realizedSol ?? 0) * solUsd)}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
