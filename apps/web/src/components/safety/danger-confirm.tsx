"use client";
/* One more question before buying a coin Kixo AI calls Danger. Manual buys only (trade
   ticket, Quick Buy); the sniper and copy trading have their own AI filters. The user can
   turn it off in Settings, Safety. */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { ShieldAlert } from "lucide-react";
import { aiScoreOf, pct, verdict } from "@/lib/ai-risk";
import { getSettings } from "@/lib/settings";

type Ask = { symbol: string; dump: number; resolve: (ok: boolean) => void };
let ask: Ask | null = null;
const listeners = new Set<() => void>();
const set = (a: Ask | null) => {
  ask = a;
  listeners.forEach((l) => l());
};

/** true: go ahead. Asks only when the AI calls this coin Danger and the warning is on. */
export function confirmDanger(mint: string, symbol: string): Promise<boolean> {
  if (!getSettings().safety.warn_danger) return Promise.resolve(true);
  const s = aiScoreOf(mint);
  if (!s || verdict(s).key !== "danger") return Promise.resolve(true);
  ask?.resolve(false);
  return new Promise((resolve) => set({ symbol, dump: s.dump, resolve }));
}

function finish(ok: boolean) {
  ask?.resolve(ok);
  set(null);
}

export function DangerConfirmHost() {
  const a = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => ask,
    () => null,
  );
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!a) return;
    cancel.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && finish(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [a]);
  if (!a) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Danger warning" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4" onClick={() => finish(false)}>
      <section className="fade-up w-full max-w-sm rounded-2xl border border-negative/30 bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <span className="tour-pop flex h-10 w-10 items-center justify-center rounded-xl border border-negative/30 bg-negative/10">
          <ShieldAlert size={18} strokeWidth={1.5} className="text-negative" />
        </span>
        <h2 className="mt-4 text-base font-medium text-text">Kixo AI says Danger</h2>
        <p className="mt-1.5 text-sm leading-6 text-text-2">
          The model gives {a.symbol || "this coin"} a {pct(a.dump)} chance of falling 70% or more within the hour. Buy anyway?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={() => finish(false)} className="h-9 rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90">
            Don&apos;t buy
          </button>
          <button type="button" onClick={() => finish(true)} className="h-9 rounded-lg border border-border px-4 text-sm text-text-2 hover:bg-surface-2 hover:text-text">
            Buy anyway
          </button>
        </div>
        <p className="mt-3 text-[11px] text-muted">Turn this question off in Settings, Safety</p>
      </section>
    </div>
  );
}
