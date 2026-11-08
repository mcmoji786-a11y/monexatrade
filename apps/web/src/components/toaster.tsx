"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { dismissToast, useToasts, type Toast } from "@/lib/toast";

const DOT = { good: "bg-positive", bad: "bg-negative", info: "bg-cyan" } as const;
const FIGURE = { good: "text-positive", bad: "text-negative", info: "text-text" } as const;

/** In-app notifications, top right under the top bar, newest on top. */
export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[55] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>
  );
}

function ToastCard({ t }: { t: Toast }) {
  const content = (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[t.tone]}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text">{t.title}</span>
        {t.figure && <span className={`mt-1 block font-mono text-xl tabular-nums leading-tight ${FIGURE[t.tone]}`}>{t.figure}</span>}
        {t.body && <span className="mt-1 line-clamp-2 block text-xs text-text-2">{t.body}</span>}
      </span>
    </span>
  );
  return (
    <div className="row-in pointer-events-auto rounded-xl border border-border bg-surface-2 p-3 shadow-lg shadow-black/40">
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
