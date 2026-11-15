"use client";
/* Small live pieces inside the welcome tour cards. Each shows the real thing where Kixo
   has it (coins launching now, traders on Kixo, the demo balance), or a clearly labelled
   example (a sniper rule). Motion stays small and stops for reduced-motion users. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, Check, Coins, Users } from "lucide-react";
import { formatAge, useNow, useRadarFeed } from "@/components/radar/use-radar-feed";
import { TokenLogo } from "@/components/token/token-bits";
import { VERDICTS } from "@/lib/ai-risk";
import { useDemo } from "@/lib/demo";
import { getTraders, type TraderRow } from "@/lib/social";
import { TraderAvatar } from "@/components/social/social-bits";

function reduced() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The demo balance counts up from zero. */
export function DemoCount() {
  const demo = useDemo();
  const target = demo.account?.equity_usd ?? demo.account?.start_usd ?? 10_000;
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduced()) {
      const id = setTimeout(() => setV(target), 0);
      return () => clearTimeout(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return (
    <div className="flex items-baseline justify-between rounded-xl border border-border bg-bg px-4 py-3">
      <span className="text-xs text-muted">Demo balance</span>
      <span className="font-mono text-2xl text-text">${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}

/** "Press / to try it": the tour moves on when the user does. */
export function SearchTry({ onDone }: { onDone: () => void }) {
  const [hit, setHit] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "/" || hit) return;
      setHit(true);
      setTimeout(onDone, 900);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [hit, onDone]);
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors duration-300 ${hit ? "border-emerald/50 bg-emerald/5" : "border-border bg-bg"}`}>
      {hit ? (
        <Check size={16} strokeWidth={1.5} className="tour-pop text-emerald" />
      ) : (
        <kbd className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 font-mono text-sm text-text">/</kbd>
      )}
      <span className="text-sm text-text-2">{hit ? "That is the shortcut. Search is ready" : "Try it: press / on your keyboard"}</span>
    </div>
  );
}

/** The three newest coins on Sol Radar, live; a new launch slides in on top. */
export function RadarLive() {
  const { tokens } = useRadarFeed();
  const now = useNow();
  const top = useMemo(() => [...tokens].sort((a, b) => b.timestamp - a.timestamp).slice(0, 3), [tokens]);
  return (
    <div className="rounded-xl border border-border bg-bg">
      <p className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-muted">
        <span className="live-ring h-1.5 w-1.5 rounded-full bg-emerald" />
        Launching right now
      </p>
      {top.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted">Waiting for the next launch</p>
      ) : (
        <ul>
          {top.map((t) => (
            <li key={t.mint} className="row-in flex h-11 items-center gap-2.5 px-3">
              <TokenLogo src={t.meta?.image ?? null} symbol={t.symbol} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm text-text">{t.symbol}</span>
              <span className="text-[11px] text-muted">{t.launchpad}</span>
              <span className="w-10 text-right font-mono text-xs text-text-2">{now ? formatAge(now / 1000 - t.timestamp) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The four AI words, lit one after another. */
export function AiWords() {
  const keys = ["danger", "careful", "calm", "good"] as const;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced()) return;
    const id = setInterval(() => setN((x) => (x + 1) % keys.length), 1100);
    return () => clearInterval(id);
  }, [keys.length]);
  const v = VERDICTS[keys[n]];
  return (
    <div className="rounded-xl border border-border bg-bg px-3 py-3">
      <div className="flex flex-wrap gap-1.5">
        {keys.map((k, i) => (
          <span key={k} className={`rounded-md border px-2 py-0.5 text-xs transition-all duration-300 ${i === n ? VERDICTS[k].className : "border-border text-muted"}`}>
            {VERDICTS[k].label}
          </span>
        ))}
      </div>
      <p key={n} className="fade-up mt-2 text-xs text-text-2">{v.sentence}</p>
    </div>
  );
}

/** An example sniper rule, built one part at a time. */
export function SniperRule() {
  const parts = ["Buy $25 of a new coin", "Sell at +200%", "or at −20%"];
  const [n, setN] = useState(reduced() ? parts.length : 0);
  useEffect(() => {
    if (n >= parts.length) return;
    const id = setTimeout(() => setN((x) => x + 1), 550);
    return () => clearTimeout(id);
  }, [n, parts.length]);
  return (
    <div className="rounded-xl border border-border bg-bg px-3 py-3">
      <p className="text-[11px] text-muted">Example rule</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {parts.slice(0, n).map((p, i) => (
          <span key={p} className={`fade-up rounded-md border px-2 py-1 text-xs ${i === 0 ? "border-border text-text" : i === 1 ? "border-positive/40 text-positive" : "border-negative/40 text-negative"}`}>
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Traders on Kixo now: the most followed three, and how many there are. */
export function CommunityPeople() {
  const [rows, setRows] = useState<TraderRow[] | null>(null);
  useEffect(() => {
    getTraders("", "followers")
      .then((r) => setRows(r.traders))
      .catch(() => setRows([]));
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3 py-3">
      <div className="flex -space-x-2">
        {rows.slice(0, 4).map((r, i) => (
          <span key={r.handle} className="tour-pop rounded-full ring-2 ring-bg" style={{ animationDelay: `${120 + i * 90}ms` }}>
            <TraderAvatar handle={r.handle} size={28} />
          </span>
        ))}
      </div>
      <span className="text-xs text-text-2">
        {rows.length} {rows.length === 1 ? "trader" : "traders"} on Kixo{rows.length >= 50 ? " and more" : ""}
      </span>
    </div>
  );
}

/** The last card: three first things to do, each a link. */
export function FirstSteps({ onPick }: { onPick: () => void }) {
  const items = [
    { href: "/radar", icon: Coins, label: "Make your first demo trade", hint: "Pick a coin on Sol Radar" },
    { href: "/community", icon: Users, label: "Follow a trader", hint: "See their trades as they happen" },
    { href: "/settings#alerts", icon: BellRing, label: "Get alerts on Telegram", hint: "Even when Kixo is closed" },
  ];
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((it, i) => (
        <li key={it.href} className="fade-up" style={{ animationDelay: `${100 + i * 110}ms` }}>
          <Link href={it.href} onClick={onPick} className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3 py-2.5 transition-colors hover:border-emerald/40 hover:bg-surface-2">
            <it.icon size={16} strokeWidth={1.5} className="text-emerald" />
            <span className="min-w-0">
              <span className="block text-sm text-text">{it.label}</span>
              <span className="block text-xs text-muted">{it.hint}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** What the letters on the chart mean (price-chart.tsx MARKS). */
export function MarksLegend() {
  const marks = [
    { l: "D", c: "#e0a63e", t: "Creator" },
    { l: "S", c: "#e4e4e7", t: "Smart wallet" },
    { l: "W", c: "#67e8f9", t: "Whale" },
    { l: "E", c: "#e5484d", t: "Sniper exit" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-bg px-3 py-3">
      {marks.map((m, i) => (
        <span key={m.l} className="fade-up flex items-center gap-2 text-xs text-text-2" style={{ animationDelay: `${80 + i * 90}ms` }}>
          <span className="flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[10px] font-semibold text-[#08090a]" style={{ backgroundColor: m.c }}>
            {m.l}B
          </span>
          {m.t}
        </span>
      ))}
      <span className="col-span-2 mt-1 text-[11px] text-muted">B is a buy, S a sell. The Marks button turns them off</span>
    </div>
  );
}
