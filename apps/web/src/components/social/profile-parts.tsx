"use client";
/* Pieces of a trader's profile: earned badges, the share button, profit over time and
   the month calendar of profit and loss. */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { money, type Badge, type DailyPnl } from "@/lib/social";
import { pushToast } from "@/lib/toast";

export function XGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const BADGE_TONE: Record<string, string> = {
  founding_trader: "border-warning/40 text-warning",
  founding_member: "border-warning/30 text-warning",
  top10: "border-cyan/40 text-cyan",
};

/** An earned badge; hover or focus says how it was earned. */
export function BadgeChip({ b }: { b: Badge }) {
  return (
    <span title={b.why} tabIndex={0} className={`cursor-help rounded-md border px-2 py-0.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-text-2 ${BADGE_TONE[b.key] ?? "border-border text-text-2"}`}>
      {b.label}
    </span>
  );
}

/** Share the profile: the phone's share sheet, else the link copied. */
export function ShareProfile({ handle }: { handle: string }) {
  const share = async () => {
    const url = `${window.location.origin}/u/${handle}`;
    try {
      if (navigator.share) await navigator.share({ title: `@${handle} on Kixo`, url });
      else {
        await navigator.clipboard.writeText(url);
        pushToast({ tone: "good", title: "Profile link copied" });
      }
    } catch {
      // The share sheet was closed: nothing to do.
    }
  };
  return (
    <button type="button" onClick={share} aria-label="Share profile" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-2 hover:bg-surface-2 hover:text-text">
      <Share2 size={15} strokeWidth={1.5} />
    </button>
  );
}

const usd0 = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Profit taken over the period as a running total, one point a day. */
export function PnlChart({ daily, days }: { daily: DailyPnl[]; days: number }) {
  const [today] = useState(() => new Date());
  const points = useMemo(() => {
    const by = new Map(daily.map((d) => [d.day, d.realized_usd]));
    const out: { day: string; total: number; v: number }[] = [];
    let total = 0;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const v = by.get(dayKey(d)) ?? 0;
      total += v;
      out.push({ day: dayKey(d), total, v });
    }
    return out;
  }, [daily, days, today]);
  if (!points.some((p) => p.v !== 0)) return <p className="px-5 py-8 text-center text-sm text-muted">No profit or loss taken in this period yet</p>;
  const w = 600;
  const h = 140;
  const pad = 8;
  const vals = [0, ...points.map((p) => p.total)];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * w;
  const y = (v: number) => pad + (1 - (v - lo) / range) * (h - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join("");
  const end = points[points.length - 1].total;
  const up = end >= 0;
  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">Profit taken, running total</span>
        <span className={`font-mono text-sm ${up ? "text-positive" : "text-negative"}`}>{usd0(end)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`mt-2 h-36 w-full ${up ? "text-positive" : "text-negative"}`} role="img" aria-label="Profit taken over time">
        <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={`${d}L${w},${y(0)}L0,${y(0)}Z`} fill="currentColor" opacity="0.08" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {points.map((p, i) =>
          p.v !== 0 ? (
            <circle key={p.day} cx={x(i)} cy={y(p.total)} r="3" fill="currentColor">
              <title>{`${p.day}: ${usd0(p.v)} (total ${usd0(p.total)})`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
        <span>{points[0].day.slice(5)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/** A month of days, each colored by the profit or loss taken that day. */
export function PnlCalendar({ daily, hidden = false }: { daily: DailyPnl[]; hidden?: boolean }) {
  const [offset, setOffset] = useState(0);
  const [now] = useState(() => new Date());
  const by = useMemo(() => new Map(daily.map((d) => [d.day, d])), [daily]);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: lead + daysIn }, (_, i) => (i < lead ? null : new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i - lead + 1))));
  const month = cells.filter((d): d is Date => !!d).map((d) => by.get(dayKey(d))?.realized_usd ?? 0);
  const total = month.reduce((a, v) => a + v, 0);
  const green = month.filter((v) => v > 0).length;
  const red = month.filter((v) => v < 0).length;
  const max = Math.max(1, ...month.map((v) => Math.abs(v)));
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOffset((o) => o - 1)} disabled={offset <= -3} aria-label="Previous month" className="flex h-7 w-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 disabled:opacity-30">
            <ChevronLeft size={15} strokeWidth={1.5} />
          </button>
          <h2 className="min-w-32 text-center text-sm font-medium text-text">{first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
          <button type="button" onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} aria-label="Next month" className="flex h-7 w-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 disabled:opacity-30">
            <ChevronRight size={15} strokeWidth={1.5} />
          </button>
        </div>
        <p className="font-mono text-xs text-muted">
          {!hidden && (
            <>
              <span className={total >= 0 ? "text-positive" : "text-negative"}>{usd0(total)}</span> ·{" "}
            </>
          )}
          {green} green · {red} red days
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1.5 p-4">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="text-center text-[11px] text-muted">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const r = by.get(dayKey(d));
          const v = r?.realized_usd ?? 0;
          const a = Math.min(1, 0.2 + (Math.abs(v) / max) * 0.6);
          const future = d.getTime() > now.getTime();
          return (
            <div
              key={dayKey(d)}
              title={r ? `${dayKey(d)}: ${hidden ? (v > 0 ? "profit" : "loss") : usd0(v)} · ${r.trades} closed, ${r.wins} won` : dayKey(d)}
              className={`flex h-14 flex-col justify-between rounded-lg border p-1.5 sm:h-16 ${future ? "border-transparent opacity-30" : "border-border"}`}
              style={v ? { background: v > 0 ? `rgba(47, 211, 138, ${a * 0.35})` : `rgba(242, 109, 109, ${a * 0.35})` } : undefined}
            >
              <span className="text-[11px] text-text-2">{d.getUTCDate()}</span>
              {v !== 0 && !hidden && <span className={`truncate font-mono text-[11px] ${v > 0 ? "text-positive" : "text-negative"}`}>{usd0(v)}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
