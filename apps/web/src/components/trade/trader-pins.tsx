"use client";
/* Followed traders on the chart: a small round picture (or initials) with the trader's
   name under it, at the candle where they bought (under the candle) or sold (over it).
   Drawn as an HTML layer over KLineCharts, moved with every scroll, zoom and new candle.
   Several trades on one candle show the newest trader and "+N". */
import { useEffect, useMemo, useState } from "react";
import type { Chart, KLineData } from "klinecharts";
import type { Pin } from "@/lib/followed-trades";

const COLORS = ["#22d3ee", "#a3e635", "#f5c451", "#fb923c", "#f472b6", "#60a5fa", "#34d399", "#e879f9"];
const colorOf = (name: string) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (name: string) => name.replace(/^@/, "").slice(0, 2).toUpperCase();

type Placed = { key: string; x: number; y: number; buy: boolean; pins: Pin[] };

export function TraderPins({ chart, data, tf, pins }: { chart: Chart | null; data: KLineData[]; tf: number; pins: Pin[] }) {
  // Re-place on every scroll, zoom and resize of the chart.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!chart) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    for (const a of ["onScroll", "onZoom", "onVisibleRangeChange"]) chart.subscribeAction(a as never, bump);
    window.addEventListener("resize", bump);
    return () => {
      for (const a of ["onScroll", "onZoom", "onVisibleRangeChange"]) chart.unsubscribeAction(a as never, bump);
      window.removeEventListener("resize", bump);
      cancelAnimationFrame(frame);
    };
  }, [chart]);

  const placed = useMemo<Placed[]>(() => {
    void tick;
    if (!chart || !data.length || !pins.length) return [];
    const byTs = new Map(data.map((d) => [d.timestamp, d]));
    // Group by candle and side.
    const groups = new Map<string, { ts: number; buy: boolean; pins: Pin[] }>();
    for (const p of pins) {
      const ts = (p.time - (p.time % tf)) * 1000;
      if (!byTs.has(ts)) continue;
      const k = `${ts}|${p.buy ? "b" : "s"}`;
      const g = groups.get(k) ?? { ts, buy: p.buy, pins: [] };
      g.pins.push(p);
      groups.set(k, g);
    }
    const out: Placed[] = [];
    for (const [k, g] of groups) {
      const c = byTs.get(g.ts)!;
      const at = chart.convertToPixel({ timestamp: g.ts, value: g.buy ? c.low : c.high }, { paneId: "candle_pane" }) as { x?: number; y?: number };
      if (at.x == null || at.y == null || !Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
      out.push({ key: k, x: at.x, y: at.y, buy: g.buy, pins: g.pins.sort((a, b) => b.time - a.time) });
    }
    return out;
  }, [chart, data, tf, pins, tick]);

  if (!placed.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-5 overflow-hidden" aria-hidden={false}>
      {placed.map((g) => {
        const p = g.pins[0];
        const more = g.pins.length - 1;
        const title = g.pins.map((x) => `${x.name} ${x.buy ? "bought" : "sold"} ${x.amount} · ${new Date(x.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`).join("\n");
        return (
          <div
            key={g.key}
            title={title}
            className="pointer-events-auto absolute flex -translate-x-1/2 cursor-default flex-col items-center"
            style={g.buy ? { left: g.x, top: g.y + 6 } : { left: g.x, top: g.y - 6, transform: "translateY(-100%)" }}
          >
            {!g.buy && <Label name={p.name} more={more} />}
            <span
              className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 bg-surface-2 text-[10px] font-semibold ${g.buy ? "border-positive" : "border-negative"}`}
              style={p.avatar ? undefined : { color: colorOf(p.name) }}
            >
              {initials(p.name)}
              {p.avatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatar} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
              )}
            </span>
            {g.buy && <Label name={p.name} more={more} />}
          </div>
        );
      })}
    </div>
  );
}

function Label({ name, more }: { name: string; more: number }) {
  return (
    <span className="my-0.5 max-w-24 truncate rounded bg-bg/80 px-1 text-[11px] leading-4 text-text">
      {name}
      {more > 0 && <span className="text-muted"> +{more}</span>}
    </span>
  );
}
