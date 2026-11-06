"use client";

import { usd } from "@/lib/gateway";
import { RadarScope } from "@/components/radar/radar-scope";
import { formatAge, useNow, useRadarFeed } from "@/components/radar/use-radar-feed";
import { PreviewFrame } from "./visuals";

/** The Discover tab shows the real Sol Radar feed, not an illustration. */
export function RadarPanel() {
  const { tokens, status } = useRadarFeed();
  const now = useNow();
  const top = [...tokens]
    .filter((t) => t.market?.sol_quoted !== false)
    .sort((a, b) => (b.market?.volume_1h_usd ?? 0) - (a.market?.volume_1h_usd ?? 0))
    .slice(0, 4);

  return (
    <PreviewFrame title="Sol Radar · most traded now" live={status === "live"}>
      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="mx-auto">
          <RadarScope tokens={tokens} now={now} size={150} />
        </div>
        <ul>
          {top.length === 0 && (
            <li className="py-8 text-center text-sm text-muted">
              {status === "live" ? "Waiting for trading activity" : "Live feed offline"}
            </li>
          )}
          {top.map((t) => (
            <li key={t.mint} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
              <div className="min-w-0">
                <div className="truncate text-sm text-text">{t.symbol}</div>
                <div className="font-mono text-xs text-muted">{formatAge(now / 1000 - t.timestamp)} old</div>
              </div>
              <div className="text-right font-mono text-xs">
                <div className="text-text">{usd(t.market?.mc_usd)}</div>
                <div className="text-muted">vol {usd(t.market?.volume_1h_usd)}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </PreviewFrame>
  );
}
