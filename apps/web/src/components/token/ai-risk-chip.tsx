"use client";
import { ScanSearch } from "lucide-react";
import { AI_WINDOW_S, riskTitle, useAiRisk, verdict } from "@/lib/ai-risk";
import { useFeatures } from "@/lib/features";

/** Kixo AI's dump and 2x chances for a coin. Before the model has judged it (its first 2
 *  minutes), a young coin shows a countdown; an older coin Kixo did not see launch shows
 *  nothing, never a guess. */
export function AiRiskChip({ mint, ageSecs, size = "sm" }: { mint: string; ageSecs: number; size?: "sm" | "md" }) {
  const on = useFeatures().ai_risk;
  const risk = useAiRisk(mint, on);
  const h = size === "md" ? "h-8 px-2.5 text-xs rounded-lg" : "h-6 px-2 text-[11px] rounded-full";
  if (!on) return null;
  if (!risk) {
    const left = Math.ceil(AI_WINDOW_S + 5 - ageSecs);
    if (!(left > 0) || left > AI_WINDOW_S + 30) return null;
    return (
      <span className={`flex shrink-0 items-center gap-1 border border-border font-mono text-muted ${h}`} title="Kixo AI judges a coin from its first 2 minutes of trades">
        <ScanSearch size={12} strokeWidth={1.5} />
        {/* Coarse steps: cards past their first minute refresh every 10 seconds. */}
        AI in {left > 60 ? `${Math.min(2, Math.ceil(left / 60))}m` : `${Math.max(10, Math.ceil(left / 10) * 10)}s`}
      </span>
    );
  }
  return (
    <span className={`flex shrink-0 items-center gap-1 border ${verdict(risk).className} ${h}`} title={riskTitle(risk)}>
      <ScanSearch size={12} strokeWidth={1.5} />
      AI · {verdict(risk).label}
    </span>
  );
}
