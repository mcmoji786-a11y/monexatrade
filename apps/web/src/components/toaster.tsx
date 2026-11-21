"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, X } from "lucide-react";
import { tokenHref } from "@/lib/open-token";
import { dismissToast, useToasts, type Toast } from "@/lib/toast";

const FIGURE = { good: "text-positive", bad: "text-negative", info: "text-text" } as const;
/** Per tone: the card's border, the icon tile and the time bar. */
const TONE = {
  good: { card: "border-positive/40", tile: "bg-positive/15 text-positive", bar: "bg-positive", Icon: CheckCircle2 },
  bad: { card: "border-negative/40", tile: "bg-negative/15 text-negative", bar: "bg-negative", Icon: AlertTriangle },
  info: { card: "border-cyan/35", tile: "bg-cyan/15 text-cyan", bar: "bg-cyan", Icon: Info },
} as const;

/** In-app notifications, top right under the top bar, newest on top. */
export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-14 z-[55] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  );
}

const usdFmt = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
const priceFmt = (v: number) => (v >= 0.01 ? `$${v.toPrecision(4)}` : `$${v.toExponential(2)}`);
const tokensFmt = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));

/** A filled trade: side and coin, the amount (a sell's profit, large), the fill price and
 *  fee, and buttons for its share card and the coin. */
function TradeCard({ t }: { t: Toast & { trade: NonNullable<Toast["trade"]> } }) {
  const x = t.trade;
  const buy = x.side === "buy";
  const loss = x.pnl != null && x.pnl < 0;
  const accent = buy ? "bg-positive" : loss ? "bg-negative" : "bg-positive";
  const border = buy ? "border-positive/45" : loss ? "border-negative/45" : "border-positive/45";
  const pill = buy ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative";
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  return (
    <div className={`row-in pointer-events-auto relative overflow-hidden rounded-xl border bg-surface-2 shadow-2xl shadow-black/60 ${border}`}>
      <span className={`absolute inset-x-0 top-0 h-[3px] ${accent}`} aria-hidden="true" />
      <div className="flex items-center gap-2 px-3.5 pt-3.5">
        <span className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${pill}`}>
          {buy ? <ArrowUpRight size={13} strokeWidth={2.25} /> : <ArrowDownRight size={13} strokeWidth={2.25} />}
          {buy ? "Bought" : "Sold"}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-text">${x.symbol || "coin"}</span>
        <span className={`rounded border px-1.5 text-[10px] leading-4 ${x.venue === "demo" ? "border-warning/40 text-warning" : "border-cyan/40 text-cyan"}`}>{x.venue === "demo" ? "Demo" : "Real"}</span>
        <span className="ml-auto font-mono text-[11px] text-muted">{time}</span>
        <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="-mr-1 rounded-md p-0.5 text-muted hover:text-text">
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="px-3.5 pt-2">
        {x.pnl != null ? (
          <p className={`font-mono text-[28px] leading-8 font-semibold tabular-nums ${loss ? "text-negative" : "text-positive"}`}>
            {x.pnl >= 0 ? "+" : "−"}
            {usdFmt(Math.abs(x.pnl))}
            {x.pnlPct != null && <span className="ml-2 text-base">{`${x.pnlPct >= 0 ? "+" : "−"}${Math.abs(x.pnlPct).toFixed(2)}%`}</span>}
          </p>
        ) : (
          <p className="font-mono text-[28px] leading-8 font-semibold text-text tabular-nums">{x.usd != null ? usdFmt(x.usd) : `${x.sol.toFixed(3)} SOL`}</p>
        )}
        <p className="mt-1 font-mono text-xs text-text-2">
          {x.pnl != null && x.usd != null ? `Received ${usdFmt(x.usd)}` : x.tokens ? `${tokensFmt(x.tokens)} ${x.symbol}` : ""}
          {x.priceUsd != null && ` at ${priceFmt(x.priceUsd)}`}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-border px-3.5 py-2.5">
        <span className="font-mono text-[11px] text-muted">{x.feeUsd != null ? `Fee ${usdFmt(x.feeUsd)}` : ""}</span>
        <Link href={tokenHref(x.mint)} onClick={() => dismissToast(t.id)} className="ml-auto flex h-7 items-center rounded-md border border-border px-2.5 text-xs text-text-2 transition-colors hover:bg-surface-3 hover:text-text">
          Open coin
        </Link>
        {t.action && (
          <button
            type="button"
            onClick={() => {
              t.action!.onClick();
              dismissToast(t.id);
            }}
            className={`flex h-7 items-center rounded-md px-3 text-xs font-semibold transition-colors ${loss ? "bg-negative/15 text-negative hover:bg-negative/25" : "bg-positive/15 text-positive hover:bg-positive/25"}`}
          >
            {t.action.label}
          </button>
        )}
      </div>
      {t.life && <span className="toast-life absolute inset-x-0 bottom-0 h-0.5 origin-left opacity-70" style={{ animationDuration: `${t.life}ms` }} aria-hidden="true"><span className={`block h-full w-full ${accent}`} /></span>}
    </div>
  );
}

function ToastCard({ t }: { t: Toast }) {
  if (t.trade) return <TradeCard t={t as Toast & { trade: NonNullable<Toast["trade"]> }} />;
  const tone = TONE[t.tone];
  const content = (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.tile}`} aria-hidden="true">
        <tone.Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block truncate text-sm font-medium text-text">{t.title}</span>
        {t.figure && <span className={`mt-1 block font-mono text-xl tabular-nums leading-tight ${FIGURE[t.tone]}`}>{t.figure}</span>}
        {t.body && <span className="mt-0.5 line-clamp-2 block font-mono text-xs text-text-2">{t.body}</span>}
      </span>
    </span>
  );
  return (
    <div className={`row-in pointer-events-auto relative overflow-hidden rounded-xl border bg-surface-2 p-3 pb-3.5 shadow-xl shadow-black/50 ${tone.card}`}>
      <div className="flex items-start gap-2">
        {t.href ? (
          <Link href={t.href} onClick={() => dismissToast(t.id)} className="flex min-w-0 flex-1 hover:opacity-90">
            {content}
          </Link>
        ) : (
          content
        )}
        <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="rounded-md p-0.5 text-muted hover:text-text">
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      {/* Time left before it closes */}
      {t.life && <span className="toast-life absolute inset-x-0 bottom-0 h-0.5 origin-left opacity-70" style={{ animationDuration: `${t.life}ms` }} aria-hidden="true"><span className={`block h-full w-full ${tone.bar}`} /></span>}
      {t.action && (
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={() => {
              t.action!.onClick();
              dismissToast(t.id);
            }}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs text-text transition-colors hover:bg-surface-3"
          >
            {t.action.label}
          </button>
        </div>
      )}
    </div>
  );
}
