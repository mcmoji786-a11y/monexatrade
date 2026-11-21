"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
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

function ToastCard({ t }: { t: Toast }) {
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
