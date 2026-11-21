"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, X } from "lucide-react";
import { tokenHref } from "@/lib/open-token";
import { dismissToast, useToasts, type Toast } from "@/lib/toast";

const FIGURE = { good: "text-positive", bad: "text-negative", info: "text-text" } as const;
/** Per tone: the icon colour and the accent line. */
const TONE = {
  good: { text: "text-positive", bar: "bg-positive", Icon: CheckCircle2 },
  bad: { text: "text-negative", bar: "bg-negative", Icon: AlertTriangle },
  info: { text: "text-cyan", bar: "bg-cyan", Icon: Info },
} as const;

/** In-app notifications, top right under the top bar, newest on top. */
export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-13 z-[55] flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-1.5" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  );
}

/** Cents always, as the trade page's position figures, so the two read the same. */
const usdFmt = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** $0.08150, $0.00000580: plain digits, never 1.72e-3. */
const priceFmt = (v: number) => (v >= 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(Math.min(12, Math.ceil(-Math.log10(v)) + 3))}`);

/** A filled trade in two slim lines: side, coin and the amount (a sell's profit in its
 *  colour), then the fill price and fee with Open coin and View card. */
function TradeCard({ t }: { t: Toast & { trade: NonNullable<Toast["trade"]> } }) {
  const x = t.trade;
  const buy = x.side === "buy";
  const loss = x.pnl != null && x.pnl < 0;
  const accent = buy || !loss ? "bg-positive" : "bg-negative";
  const figure =
    x.pnl != null
      ? `${x.pnl >= 0 ? "+" : "−"}${usdFmt(Math.abs(x.pnl))}${x.pnlPct != null ? ` (${x.pnlPct >= 0 ? "+" : "−"}${Math.abs(x.pnlPct).toFixed(2)}%)` : ""}`
      : x.usd != null
        ? usdFmt(x.usd)
        : `${x.sol.toFixed(3)} SOL`;
  return (
    <div className="row-in pointer-events-auto relative overflow-hidden rounded-lg border border-border bg-surface-2 py-2 pr-2 pl-3.5 shadow-lg shadow-black/50">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${accent}`} aria-hidden="true" />
      <div className="flex items-center gap-1.5 text-[13px]">
        {buy ? <ArrowUpRight size={14} strokeWidth={2.25} className="shrink-0 text-positive" /> : <ArrowDownRight size={14} strokeWidth={2.25} className="shrink-0 text-negative" />}
        <span className="font-medium text-text">{buy ? "Bought" : "Sold"}</span>
        <span className="min-w-0 truncate font-medium text-text">${x.symbol || "coin"}</span>
        <span className={`shrink-0 text-[10px] ${x.venue === "demo" ? "text-warning/80" : "text-cyan/80"}`}>{x.venue === "demo" ? "demo" : "real"}</span>
        <span className={`ml-auto shrink-0 font-mono font-semibold tabular-nums ${x.pnl != null ? (loss ? "text-negative" : "text-positive") : "text-text"}`}>{figure}</span>
        <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="shrink-0 rounded p-0.5 text-muted hover:text-text">
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px]">
        <span className="min-w-0 truncate font-mono text-muted">
          {x.priceUsd != null ? `at ${priceFmt(x.priceUsd)}` : ""}
          {x.feeUsd != null ? ` · fee ${usdFmt(x.feeUsd)}` : ""}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5 pr-0.5">
          <Link href={tokenHref(x.mint)} onClick={() => dismissToast(t.id)} className="text-text-2 hover:text-text hover:underline">
            Open
          </Link>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
              className={`font-medium hover:underline ${loss ? "text-negative" : "text-positive"}`}
            >
              {t.action.label}
            </button>
          )}
        </span>
      </div>
      {t.life && <span className="toast-life absolute inset-x-0 bottom-0 h-px origin-left opacity-60" style={{ animationDuration: `${t.life}ms` }} aria-hidden="true"><span className={`block h-full w-full ${accent}`} /></span>}
    </div>
  );
}

function ToastCard({ t }: { t: Toast }) {
  if (t.trade) return <TradeCard t={t as Toast & { trade: NonNullable<Toast["trade"]> }} />;
  const tone = TONE[t.tone];
  const content = (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      <tone.Icon size={14} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${tone.text}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text">{t.title}</span>
        {t.figure && <span className={`block font-mono text-base tabular-nums leading-tight ${FIGURE[t.tone]}`}>{t.figure}</span>}
        {t.body && <span className="line-clamp-2 block text-[11px] text-text-2">{t.body}</span>}
      </span>
    </span>
  );
  return (
    <div className="row-in pointer-events-auto relative overflow-hidden rounded-lg border border-border bg-surface-2 py-2 pr-2 pl-3.5 shadow-lg shadow-black/50">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.bar}`} aria-hidden="true" />
      <div className="flex items-start gap-2">
        {t.href ? (
          <Link href={t.href} onClick={() => dismissToast(t.id)} className="flex min-w-0 flex-1 hover:opacity-90">
            {content}
          </Link>
        ) : (
          content
        )}
        <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="rounded-md p-0.5 text-muted hover:text-text">
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>
      {/* Time left before it closes */}
      {t.life && <span className="toast-life absolute inset-x-0 bottom-0 h-px origin-left opacity-60" style={{ animationDuration: `${t.life}ms` }} aria-hidden="true"><span className={`block h-full w-full ${tone.bar}`} /></span>}
      {t.action && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => {
              t.action!.onClick();
              dismissToast(t.id);
            }}
            className="text-[11px] font-medium text-text-2 hover:text-text hover:underline"
          >
            {t.action.label}
          </button>
        </div>
      )}
    </div>
  );
}
