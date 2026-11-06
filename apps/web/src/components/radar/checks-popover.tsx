"use client";

import { Check, ShieldCheck, X } from "lucide-react";
import type { Check as RiskCheck } from "@/lib/risk";

/** "n/13 checks" chip; hover or focus shows every lower-risk check and its result. */
export function ChecksChip({ checks }: { checks: RiskCheck[] }) {
  const passed = checks.filter((c) => c.ok).length;
  const all = passed === checks.length;
  return (
    <span className="group relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] focus-visible:outline-2 focus-visible:outline-emerald ${
          all ? "border-emerald/30 text-emerald" : "border-border text-text-2"
        }`}
        aria-label={`${passed} of ${checks.length} lower-risk checks passed`}
      >
        <ShieldCheck size={12} strokeWidth={1.5} />
        {all ? "Lower risk" : `${passed}/${checks.length}`}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-72 rounded-lg border border-border bg-surface-2 p-3 opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <span className="block text-xs font-medium text-text">
          {passed} of {checks.length} checks passed
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">Fewer red flags, not a guarantee</span>
        <span className="mt-2 flex flex-col gap-1">
          {checks.map((c) => (
            <span key={c.label} className="flex items-center gap-2 text-[11px]">
              {c.ok ? (
                <Check size={12} strokeWidth={1.5} className="shrink-0 text-positive" />
              ) : (
                <X size={12} strokeWidth={1.5} className="shrink-0 text-negative" />
              )}
              <span className={c.ok ? "text-text-2" : "text-text"}>{c.label}</span>
              <span className="ml-auto truncate font-mono text-muted">{c.detail}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
