"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { dismissToast, useToasts } from "@/lib/toast";

const TONE = {
  good: "border-positive/40",
  bad: "border-negative/40",
  info: "border-cyan/30",
} as const;
const DOT = { good: "bg-positive", bad: "bg-negative", info: "bg-cyan" } as const;

/** In-app notifications, bottom right, newest on top. */
export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const body = (
          <>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[t.tone]}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-text">{t.title}</span>
              {t.body && <span className="mt-0.5 line-clamp-2 block font-mono text-xs text-text-2">{t.body}</span>}
            </span>
          </>
        );
        return (
          <div key={t.id} className={`row-in pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface-2 p-3 shadow-lg ${TONE[t.tone]}`}>
            {t.href ? (
              <Link href={t.href} onClick={() => dismissToast(t.id)} className="flex min-w-0 flex-1 items-start gap-3 hover:opacity-90">
                {body}
              </Link>
            ) : (
              <span className="flex min-w-0 flex-1 items-start gap-3">{body}</span>
            )}
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-muted hover:text-text">
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
