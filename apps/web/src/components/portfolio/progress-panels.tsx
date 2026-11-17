"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  CalendarCheck,
  CalendarDays,
  ChevronsUp,
  Copy,
  Crosshair,
  Flame,
  Gem,
  Grid3x3,
  Layers,
  Medal,
  Share2,
  ShieldCheck,
  Target,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ACHIEVEMENTS, monthCalendar, monthStart, progress, recap, type AchievementId, type TradeLike } from "@/lib/achievements";
import { openShare } from "@/lib/share";
import { useFeatures } from "@/lib/features";
import { signed } from "@/components/trade/trade-panel";

const ICON: Record<AchievementId, LucideIcon> = {
  first_trade: ArrowRightLeft,
  first_profit: TrendingUp,
  ten_trades: Layers,
  hundred_trades: Medal,
  double: ChevronsUp,
  tenx: Gem,
  win_streak_3: Flame,
  win_streak_5: Flame,
  day_streak_3: CalendarCheck,
  day_streak_7: CalendarDays,
  protected: ShieldCheck,
  took_profit: Target,
  quick: Zap,
  sniper: Crosshair,
  grid: Grid3x3,
  copy: Copy,
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p) >= 100 ? Math.round(Math.abs(p)).toLocaleString("en-US") : Math.abs(p).toFixed(1)}%`;
const tone = (v: number) => (v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-text");

/** This week or last week (Monday to Sunday, UTC), shareable as a card. */
export function WeekRecap({ trades }: { trades: TradeLike[] }) {
  const [which, setWhich] = useState<"current" | "last">("current");
  const shareOn = useFeatures().share_cards;
  const r = useMemo(() => recap(trades, which), [trades, which]);
  const winRate = r.sells ? Math.round((r.wins / r.sells) * 100) : null;

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">
          Your week <span className="ml-1 font-mono text-xs text-muted">{`${day(r.from)} – ${day(r.to - 1)}`}</span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Week">
            {(
              [
                ["current", "This week"],
                ["last", "Last week"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={which === k}
                onClick={() => setWhich(k)}
                className={`h-7 rounded-md px-2.5 text-xs transition-colors ${which === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {shareOn && (
            <button
              type="button"
              disabled={r.trades === 0}
              onClick={() => openShare({ kind: "recap", recap: r })}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
            >
              <Share2 size={14} strokeWidth={1.5} /> Share
            </button>
          )}
        </div>
      </div>
      {r.trades === 0 ? (
        <p className="px-4 py-6 text-sm text-text-2">{which === "current" ? "No trades yet this week" : "No trades last week"}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-px bg-border md:grid-cols-5">
          <Fig k="Profit taken" v={signed(r.realizedUsd)} cls={tone(r.realizedUsd)} />
          <Fig k="Trades" v={String(r.trades)} sub={`${r.coins} ${r.coins === 1 ? "coin" : "coins"}`} />
          <Fig k="Win rate" v={winRate != null ? `${winRate}%` : "—"} sub={`${r.wins} of ${r.sells} sells`} />
          <Fig k="Best trade" v={r.best ? pct(r.best.pct) : "—"} sub={r.best ? `$${r.best.symbol}` : ""} cls={r.best ? "text-positive" : "text-text"} />
          <Fig k="Days in a row" v={String(r.dayStreak)} />
        </dl>
      )}
    </section>
  );
}

function Fig({ k, v, sub, cls = "text-text" }: { k: string; v: string; sub?: string; cls?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`mt-1 font-mono text-lg tabular-nums ${cls}`}>{v}</dd>
      {sub ? <p className="mt-0.5 truncate text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

/** Badges earned from the demo history, and the day and win streaks. */
export function Achievements({ trades }: { trades: TradeLike[] }) {
  const p = useMemo(() => progress(trades), [trades]);
  const got = ACHIEVEMENTS.filter((a) => p.unlocked[a.id]).length;

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">
          Achievements <span className="ml-1 font-mono text-xs text-muted">{`${got} of ${ACHIEVEMENTS.length}`}</span>
        </h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <Streak icon={CalendarCheck} label="Day streak" now={p.dayStreak} best={p.bestDayStreak} />
          <Streak icon={Flame} label="Win streak" now={p.winStreak} best={p.bestWinStreak} />
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        {ACHIEVEMENTS.map((a) => {
          const at = p.unlocked[a.id];
          const Icon = ICON[a.id];
          return (
            <li key={a.id} className="flex items-center gap-3 bg-surface px-4 py-3">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${at ? "border-emerald/30 bg-emerald/10 text-emerald" : "border-border text-muted"}`}
              >
                <Icon size={16} strokeWidth={1.5} />
              </span>
              <div className="min-w-0">
                <p className={`truncate text-sm ${at ? "text-text" : "text-text-2"}`}>{a.title}</p>
                <p className="truncate text-xs text-muted">{at ? `Earned ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : a.desc}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Streak({ icon: Icon, label, now, best }: { icon: LucideIcon; label: string; now: number; best: number }) {
  return (
    <span className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-text-2">
      <Icon size={14} strokeWidth={1.5} className={now > 0 ? "text-emerald" : "text-muted"} />
      {label}
      <span className="font-mono text-text">{now}</span>
      <span className="text-muted">· best {best}</span>
    </span>
  );
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "+$1.2K", "−$35", "+$0.42": short enough for a calendar cell. */
function compact(v: number) {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(a / 1e3)}K` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a >= 10 ? Math.round(a).toString() : a.toFixed(2);
  return `${v >= 0 ? "+" : "−"}$${s}`;
}

/** Profit taken on each day of a month (UTC days, like the weekly recap). */
export function PnlCalendar({ trades }: { trades: TradeLike[] }) {
  const [offset, setOffset] = useState(0);
  const [now] = useState(() => Date.now());
  const m = useMemo(() => monthCalendar(trades, monthStart(now, offset)), [trades, offset, now]);
  const today = Math.floor(now / DAY_MS);
  // Monday-first grid: blank cells before the 1st.
  const lead = (new Date(m.from).getUTCDay() + 6) % 7;
  const label = new Date(m.from).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const oldest = useMemo(() => trades.reduce((a, t) => Math.min(a, new Date(t.ts).getTime()), now), [trades, now]);
  const canBack = offset > -24 && monthStart(now, offset - 1) >= monthStart(oldest);

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">Profit calendar</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" disabled={!canBack} onClick={() => setOffset((o) => o - 1)} className="flex size-8 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-30">
            <ChevronLeft size={16} strokeWidth={1.5} />
          </button>
          <span className="w-32 text-center font-mono text-xs text-text">{label}</span>
          <button type="button" aria-label="Next month" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)} className="flex size-8 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-30">
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
        <Fig k="Profit taken" v={m.greenDays + m.redDays ? signed(m.realizedUsd) : "—"} cls={tone(m.realizedUsd)} />
        <Fig k="Green days" v={String(m.greenDays)} cls={m.greenDays ? "text-positive" : "text-text"} />
        <Fig k="Red days" v={String(m.redDays)} cls={m.redDays ? "text-negative" : "text-text"} />
        <Fig k="Best day" v={m.best ? signed(m.best.realizedUsd) : "—"} sub={m.best ? day(m.best.day * DAY_MS) : ""} cls={m.best ? "text-positive" : "text-text"} />
      </dl>

      <div className="p-3">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <span key={w} className="pb-1 text-center text-xs text-muted">
              {w}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} aria-hidden />
          ))}
          {Array.from({ length: m.length }, (_, i) => {
            const k = m.firstDay + i;
            const c = m.days.get(k);
            const v = c && c.sells ? c.realizedUsd : null;
            const bg = v == null ? "bg-bg" : v >= 0.01 ? "bg-positive/10" : v <= -0.01 ? "bg-negative/10" : "bg-surface-2";
            return (
              <div
                key={k}
                title={c ? `${day(k * DAY_MS)}: ${c.trades} ${c.trades === 1 ? "trade" : "trades"}${v != null ? `, ${signed(v)} taken` : ""}` : undefined}
                className={`flex h-14 flex-col justify-between rounded-md border p-1.5 ${k === today ? "border-text-2/40" : "border-border"} ${bg} ${k > today ? "opacity-40" : ""}`}
              >
                <span className="font-mono text-xs text-muted">{i + 1}</span>
                {v != null ? (
                  <span className={`truncate text-right font-mono text-xs tabular-nums ${tone(v)}`}>{compact(v)}</span>
                ) : c ? (
                  <span className="truncate text-right font-mono text-xs text-muted">{c.trades}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">
          Profit or loss taken on sells each day, after fees, in UTC days. A grey number means trades but no sells that day{trades.length >= 1000 ? ". Counts your latest 1,000 trades" : ""}
        </p>
      </div>
    </section>
  );
}
