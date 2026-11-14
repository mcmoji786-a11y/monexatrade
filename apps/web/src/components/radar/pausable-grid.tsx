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
    // A real mouse only: a tap on a phone fires mouse-enter but never mouse-leave, which
    // froze the list on phones until the page was left.
    <div
      className="relative mt-4"
      onPointerEnter={(e) => e.pointerType === "mouse" && setFrozen(tokens)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setFrozen(null)}
    >
      {/* Paused: said plainly at the top, with how many new coins wait, so a frozen list
          never reads as a slow feed. "Show now" lets them in without leaving the list. */}
      {frozen && (
        <div className="sticky top-2 z-10 mb-3 flex h-9 items-center gap-2 rounded-lg border border-warning/30 bg-surface-2 px-3 text-xs text-warning shadow-lg shadow-black/30">
          <Pause size={14} strokeWidth={1.5} />
          <span>Paused while your pointer is on the list</span>
          {waiting > 0 && (
            <button
              type="button"
              onClick={() => setFrozen(tokens)}
              className="ml-auto flex h-7 items-center rounded-md bg-warning/15 px-2.5 font-medium text-warning transition-colors hover:bg-warning/25"
            >
              Show {waiting} new
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">{shown.slice(0, limit).map(render)}</div>
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
