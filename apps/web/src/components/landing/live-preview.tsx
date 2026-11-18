"use client";

import { usd } from "@/lib/gateway";
import { AI_WINDOW_S, useAiRisk, verdict, VERDICTS } from "@/lib/ai-risk";
import { RadarScope } from "@/components/radar/radar-scope";
import { formatAge, useNow, useRadarFeed } from "@/components/radar/use-radar-feed";

/** The AI's word for a coin, the page's signature: Danger, Careful, Calm or Good odds.
 *  Before its first 2 minutes are over, a countdown to the verdict. */
export function VerdictTag({ mint, ageS }: { mint: string; ageS: number }) {
  const risk = useAiRisk(mint);
  if (risk) {
    const v = verdict(risk);
    return <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs ${v.className}`}>{v.label}</span>;
  }
  if (ageS < AI_WINDOW_S + 15) {
    return <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2 font-mono text-xs text-muted">AI in {Math.max(1, Math.ceil(AI_WINDOW_S - ageS))}s</span>;
  }
  return <span className="inline-flex h-6 shrink-0 items-center px-2 font-mono text-xs text-muted">—</span>;
}

/** The four words Kixo AI answers in (for server-rendered sections). */
export function VerdictLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {(["danger", "careful", "calm", "good"] as const).map((k) => (
        <span key={k} className={`inline-flex h-6 items-center rounded-full border px-2 text-xs ${VERDICTS[k].className}`}>
          {VERDICTS[k].label}
        </span>
      ))}
    </div>
  );
}

/** Hero visual: the real Sol Radar, live, with Kixo AI's word on every coin. */
export function LivePreview() {
  const { tokens, status } = useRadarFeed();
  const now = useNow();
  const newest = [...tokens].sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);
  const lastMinute = now ? tokens.filter((t) => now / 1000 - t.timestamp <= 60).length : 0;
  const live = status === "live";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-medium text-text">Sol Radar</span>
        <span className="flex items-center gap-2 font-mono text-xs text-text-2">
          <span className={`size-1.5 rounded-full ${live ? "bg-emerald" : "bg-warning"}`} />
          {live ? `${lastMinute} launches in the last minute` : "Live feed offline"}
        </span>
      </div>

      <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="mx-auto hidden sm:block">
          <RadarScope tokens={tokens} now={now} size={192} />
        </div>

        <ul className="min-w-0">
          {newest.length === 0 && (
            <li className="py-10 text-center text-sm text-muted">{live ? "Waiting for the next launch" : "Start the Kixo gateway to see live launches"}</li>
          )}
          {newest.map((t) => {
            const age = now / 1000 - t.timestamp;
            return (
              <li key={t.mint} className="row-in flex h-12 items-center gap-3 border-b border-border last:border-0">
                <div className="size-8 shrink-0 overflow-hidden rounded-md border border-border bg-surface-3">
                  {t.meta?.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.meta.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{t.symbol || "—"}</div>
                  <div className="truncate font-mono text-xs text-muted">
                    {t.market?.sol_quoted === false ? "—" : usd(t.market?.mc_usd)} · {formatAge(age)}
                  </div>
                </div>
                <VerdictTag mint={t.mint} ageS={age} />
              </li>
            );
          })}
        </ul>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted">Real launches, right now. Kixo AI gives each coin its word after its first 2 minutes</p>
    </div>
  );
}
