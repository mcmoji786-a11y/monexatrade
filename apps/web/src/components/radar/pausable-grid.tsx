"use client";

import { useMemo, useState } from "react";
import { Pause } from "lucide-react";
import type { RadarToken } from "./use-radar-feed";

/** The radar grid. While the pointer is over it the list freezes: no new coins slide
 *  in and cards keep their place, so a card can be read and clicked. Figures on the
 *  frozen cards still update. */
const PAGE = 36;

export function PausableGrid({ tokens, render }: { tokens: RadarToken[]; render: (t: RadarToken) => React.ReactNode }) {
  // Frozen: the coins and order at the moment the pointer came in, with their latest
  // data. A coin that left the radar meanwhile keeps its last card until release.
  const [frozen, setFrozen] = useState<RadarToken[] | null>(null);
  // Cards are rich and update every second: render a page at a time so the browser
  // stays responsive with hundreds of coins on the radar.
  const [limit, setLimit] = useState(PAGE);
  const current = useMemo(() => new Map(tokens.map((t) => [t.mint, t])), [tokens]);
  const shown = frozen ? frozen.map((t) => current.get(t.mint) ?? t) : tokens;
  const waiting = frozen ? tokens.filter((t) => !frozen.some((f) => f.mint === t.mint)).length : 0;

  return (
    <div className="relative mt-4" onMouseEnter={() => setFrozen(tokens)} onMouseLeave={() => setFrozen(null)}>
      {frozen && (
        <span
          className="absolute -top-3 right-2 z-10 flex items-center gap-1 rounded-full border border-warning/30 bg-surface-2 px-2 py-0.5 text-xs text-warning"
          title="Move the pointer away to resume"
        >
          <Pause size={12} strokeWidth={1.5} />
          Paused{waiting > 0 && ` · ${waiting} new`}
        </span>
      )}
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{shown.slice(0, limit).map(render)}</div>
      {shown.length > limit && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="h-9 rounded-lg border border-border px-4 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            Show {Math.min(PAGE, shown.length - limit)} more · {shown.length - limit} hidden
          </button>
        </div>
      )}
    </div>
  );
}
