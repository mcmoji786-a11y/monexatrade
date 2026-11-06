"use client";

import { useFeatures } from "@/lib/features";
import type { Safety } from "@/lib/safety";

const TONE = { higher: "text-positive", medium: "text-warning", low: "text-negative" } as const;
const WORD = { higher: "Fewer red flags", medium: "Some red flags", low: "Many red flags" } as const;

/** Safety score as a small ring with the number; hover or focus lists every factor and
 *  the points it moved. `size`: "sm" for tables and cards, "md" for spotlights. */
function SafetyBadgeInner({ safety, size = "sm" }: { safety: Safety; size?: "sm" | "md" }) {
  const r = size === "md" ? 15 : 11;
  const box = (r + 3) * 2;
  const c = 2 * Math.PI * r;
  const tone = TONE[safety.level];
  return (
    <span className="group relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={`Safety score ${safety.score} of 100: ${WORD[safety.level]}`}
        className={`inline-flex items-center gap-1.5 rounded-full focus-visible:outline-2 focus-visible:outline-emerald ${tone}`}
      >
        <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="-rotate-90">
          <circle cx={box / 2} cy={box / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
          <circle
            cx={box / 2}
            cy={box / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - safety.score / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <span className={`font-mono ${size === "md" ? "text-sm" : "text-xs"}`}>{safety.score}%</span>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-30 mb-2 w-80 rounded-lg border border-border bg-surface-2 p-3 text-left opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <span className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-text">Safety {safety.score}/100</span>
          <span className={`text-[11px] ${tone}`}>{WORD[safety.level]}</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">Starts at 100. Red flags take points off. Not a guarantee</span>
        <span className="mt-2 flex flex-col gap-1">
          {safety.factors.length === 0 && <span className="text-[11px] text-text-2">No red flags in the data so far</span>}
          {safety.factors.map((x) => (
            <span key={x.label} className="flex items-baseline gap-2 text-[11px]">
              <span className={`w-8 shrink-0 text-right font-mono ${x.points < 0 ? "text-negative" : "text-positive"}`}>
                {x.points > 0 ? "+" : ""}
                {x.points}
              </span>
              <span className="text-text-2">{x.label}</span>
              {x.detail && <span className="ml-auto truncate font-mono text-muted">{x.detail}</span>}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/** Hidden when the admin switches "safety_score" off (lib/features.ts). */
export function SafetyBadge(props: { safety: Safety; size?: "sm" | "md" }) {
  const f = useFeatures();
  return f.safety_score ? <SafetyBadgeInner {...props} /> : null;
}
