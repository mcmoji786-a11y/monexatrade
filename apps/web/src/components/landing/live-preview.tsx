"use client";

import { usd } from "@/lib/gateway";
import { RadarScope } from "@/components/radar/radar-scope";
import { formatAge, useNow, useRadarFeed } from "@/components/radar/use-radar-feed";

/** Hero visual: the real Sol Radar, live. Every blip and row is an actual launch. */
export function LivePreview() {
  const { tokens, status } = useRadarFeed();
  const now = useNow();
  const newest = [...tokens].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  const lastMinute = now ? tokens.filter((t) => now / 1000 - t.timestamp <= 60).length : 0;
  const live = status === "live";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-medium text-text">Sol Radar</span>
        <span className="flex items-center gap-1.5 font-mono text-xs text-text-2">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : "bg-warning"}`} />
          {live ? `${lastMinute} launches in the last minute` : "Live feed offline"}
        </span>
      </div>

      <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="mx-auto">
          <RadarScope tokens={tokens} now={now} size={208} />
        </div>

        <ul className="min-w-0">
          {newest.length === 0 && (
            <li className="py-10 text-center text-sm text-muted">
              {live ? "Waiting for the next launch" : "Start the MONEXA gateway to see live launches"}
            </li>
          )}
          {newest.map((t) => (
            <li key={t.mint} className="row-in flex items-center gap-3 border-b border-border py-2.5 last:border-0">
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-border bg-surface-3">
                {t.meta?.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.meta.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{t.symbol || "—"}</div>
                <div className="truncate text-xs text-muted">{t.name}</div>
              </div>
              <div className="text-right font-mono text-xs">
                <div className="text-text">{t.market?.sol_quoted === false ? "—" : usd(t.market?.mc_usd)}</div>
                <div className={now / 1000 - t.timestamp < 60 ? "text-emerald" : "text-muted"}>
                  {formatAge(now / 1000 - t.timestamp)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
