"use client";

import { useEffect, useState } from "react";

/* Illustrative product previews for the landing page. Every panel that is not
   backed by live data carries a visible "Preview" label (see PreviewFrame). */

export function PreviewFrame({ title, children, live = false }: { title: string; children: React.ReactNode; live?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
      <div className="flex h-11 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-medium text-text">{title}</span>
        {live ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-emerald">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
            Live
          </span>
        ) : (
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted">Preview</span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/** Cycles through a list on an interval, so previews show the flow of events. */
function useCycle(length: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % length), ms);
    return () => clearInterval(id);
  }, [length, ms]);
  return i;
}

/* ---------- Discover: token analytics ---------- */

const CANDLES = [
  [40, 46, 38, 44], [44, 52, 43, 50], [50, 51, 45, 47], [47, 58, 46, 56], [56, 63, 54, 61],
  [61, 62, 52, 54], [54, 57, 49, 55], [55, 68, 54, 66], [66, 72, 63, 64], [64, 66, 57, 59],
  [59, 70, 58, 69], [69, 78, 67, 76], [76, 77, 70, 72], [72, 80, 71, 79], [79, 86, 77, 84],
];

export function DiscoverVisual() {
  const w = 300;
  const h = 120;
  const step = w / CANDLES.length;
  const y = (v: number) => h - ((v - 35) / 55) * h;
  return (
    <PreviewFrame title="Token page">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium text-text">ORBIT</div>
          <div className="text-xs text-muted">Orbit Cat</div>
        </div>
        <div className="text-right font-mono">
          <div className="text-sm text-text">$84.2K</div>
          <div className="text-xs text-positive">+18.4% 1h</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-32 w-full" preserveAspectRatio="none" aria-hidden>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="var(--mx-border)" />
        ))}
        {CANDLES.map(([o, hi, lo, c], i) => {
          const up = c >= o;
          const x = i * step + step / 2;
          return (
            <g key={i} className="fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <line x1={x} x2={x} y1={y(hi)} y2={y(lo)} stroke={up ? "var(--mx-positive)" : "var(--mx-negative)"} />
              <rect
                x={x - step * 0.3}
                width={step * 0.6}
                y={y(Math.max(o, c))}
                height={Math.max(1, Math.abs(y(o) - y(c)))}
                fill={up ? "var(--mx-positive)" : "var(--mx-negative)"}
                rx="1"
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 font-mono text-xs">
        <Kv k="Holders" v="1,284" />
        <Kv k="Top 10" v="21%" />
        <Kv k="Mint authority" v="Revoked" good />
      </div>
      <div className="mt-4">
        <div className="text-xs text-muted">Holder distribution</div>
        <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full">
          {[21, 14, 9, 56].map((p, i) => (
            <div
              key={i}
              className="grow-x h-full"
              style={{ width: `${p}%`, animationDelay: `${200 + i * 80}ms`, background: i === 0 ? "var(--mx-emerald)" : `rgb(237 237 237 / ${0.28 - i * 0.07})` }}
            />
          ))}
        </div>
      </div>
    </PreviewFrame>
  );
}

function Kv({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div>
      <div className="text-muted">{k}</div>
      <div className={`mt-1 ${good ? "text-positive" : "text-text"}`}>{v}</div>
    </div>
  );
}

/* ---------- Trade: order ticket ---------- */

export function TradeVisual() {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.5");
  const fee = (parseFloat(amount) * 0.005).toFixed(4);

  return (
    <PreviewFrame title="Order ticket">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`h-8 rounded-md text-sm capitalize transition-colors ${
              side === s ? (s === "buy" ? "bg-emerald text-bg" : "bg-negative text-text") : "text-text-2 hover:text-text"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mt-4 text-xs text-muted">Amount</div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {["0.1", "0.5", "1", "2"].map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAmount(a)}
            className={`h-9 rounded-lg border font-mono text-sm transition-colors ${
              amount === a ? "border-emerald/60 bg-surface-3 text-text" : "border-border text-text-2 hover:bg-surface-2"
            }`}
          >
            {a} SOL
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-xs">
        <Kv k="Slippage" v="15%" />
        <Kv k="Priority fee" v="0.001 SOL" />
        <Kv k="MEV protect" v="On" good />
      </div>
      <div className="mt-4 space-y-2 rounded-lg border border-border bg-bg p-3 font-mono text-xs">
        <Row k="Take profit" v="+100% · sell 50%" />
        <Row k="Stop loss" v="−30%" />
        <Row k="Trailing stop" v="15%" />
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-muted">Platform fee 0.5%</span>
        <span className="font-mono text-text-2">{fee} SOL</span>
      </div>
      <div className={`mt-3 flex h-10 items-center justify-center rounded-lg text-sm font-medium ${side === "buy" ? "bg-emerald text-bg" : "bg-negative text-text"}`}>
        Simulate, then sign in wallet
      </div>
    </PreviewFrame>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className="text-text-2">{v}</span>
    </div>
  );
}

/* ---------- Automate: sniper and copy trading ---------- */

const DECISIONS = [
  { verdict: "Copy", tone: "text-positive", text: "7xKp…3Fa bought ORBIT · liquidity ok, top 10 at 22%" },
  { verdict: "Skip", tone: "text-warning", text: "9Qe2…Lm1 bought LUNA2 · dev holds 41%" },
  { verdict: "Copy", tone: "text-positive", text: "7xKp…3Fa sold half of BEAM · following exit" },
  { verdict: "Skip", tone: "text-warning", text: "Late entry · price up 240% since the wallet bought" },
  { verdict: "Stop", tone: "text-negative", text: "Daily loss limit reached · copying paused" },
];

export function AutomateVisual() {
  const i = useCycle(DECISIONS.length, 1800);
  const shown = [0, 1, 2].map((k) => DECISIONS[(i + DECISIONS.length - k) % DECISIONS.length]);

  return (
    <PreviewFrame title="Bots and copy trading">
      <div className="space-y-2">
        {[
          { name: "Migration sniper", note: "Buy 0.2 SOL on migration · max 5 open", on: true },
          { name: "New pair sniper", note: "Min liquidity 20 SOL · socials required", on: true },
          { name: "Copy 7xKp…3Fa", note: "Fixed 0.3 SOL · TP 80% · SL 25%", on: false },
        ].map((b) => (
          <div key={b.name} className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2.5">
            <div>
              <div className="text-sm text-text">{b.name}</div>
              <div className="text-xs text-muted">{b.note}</div>
            </div>
            <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${b.on ? "bg-emerald" : "bg-surface-3"}`}>
              <span className={`h-4 w-4 rounded-full bg-text transition-transform ${b.on ? "translate-x-4" : ""}`} />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-muted">Decision log</div>
      <ul className="mt-2 space-y-2 font-mono text-xs">
        {shown.map((d, k) => (
          <li key={`${i}-${k}`} className={`flex gap-3 ${k === 0 ? "fade-up" : ""}`} style={{ opacity: 1 - k * 0.3 }}>
            <span className={`w-10 shrink-0 ${d.tone}`}>{d.verdict}</span>
            <span className="text-text-2">{d.text}</span>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

/* ---------- Intelligence: AI research ---------- */

const FINDINGS = [
  { tag: "Verified", tone: "text-positive", text: "Mint and freeze authority are revoked" },
  { tag: "Verified", tone: "text-positive", text: "Liquidity pool created 14 minutes after launch" },
  { tag: "Verified", tone: "text-warning", text: "3 wallets funded by one source hold 18% of supply" },
  { tag: "Estimate", tone: "text-text-2", text: "Buy pressure is slowing over the last 15 minutes" },
];

export function IntelligenceVisual() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v >= FINDINGS.length ? 1 : v + 1)), 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <PreviewFrame title="Research report">
      <div className="flex items-center justify-between">
        <div className="text-sm text-text">ORBIT · risk review</div>
        <div className="font-mono text-xs text-warning">Medium risk</div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full w-[58%] rounded-full bg-warning" />
      </div>
      <ul className="mt-5 space-y-3">
        {FINDINGS.slice(0, n).map((f, k) => (
          <li key={k} className="fade-up flex gap-3 text-sm">
            <span className={`w-16 shrink-0 font-mono text-xs leading-5 ${f.tone}`}>{f.tag}</span>
            <span className="text-text-2">{f.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted">
        Every finding is marked as a verified on-chain fact or as an estimate. No price predictions.
      </p>
    </PreviewFrame>
  );
}

/* ---------- Track: wallets, portfolio, alerts ---------- */

const ALERTS = [
  { k: "Whale buy", v: "7xKp…3Fa bought 42 SOL of ORBIT" },
  { k: "Take profit", v: "BEAM hit +100% · sold 50%" },
  { k: "Price alert", v: "LUNA2 crossed $120K market cap" },
  { k: "Failed trade", v: "Slippage too low · suggested 18%" },
];

export function TrackVisual() {
  const i = useCycle(ALERTS.length, 2000);
  const a = ALERTS[i];
  return (
    <PreviewFrame title="Portfolio and alerts">
      <div className="text-xs text-muted">Portfolio value</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="font-mono text-3xl text-text">$12,480</span>
        <span className="font-mono text-xs text-positive">+$1,920 today</span>
      </div>
      <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full">
        {[46, 28, 16, 10].map((p, k) => (
          <div
            key={k}
            className="grow-x h-full"
            style={{ width: `${p}%`, animationDelay: `${k * 80}ms`, background: k === 0 ? "var(--mx-emerald)" : `rgb(237 237 237 / ${0.3 - k * 0.07})` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted">
        <span>SOL 46%</span>
        <span>ORBIT 28%</span>
        <span>BEAM 16%</span>
        <span>Other 10%</span>
      </div>
      <div className="mt-5 text-xs text-muted">Tracked wallet · 7xKp…3Fa</div>
      <div className="mt-2 grid grid-cols-3 gap-3 font-mono text-xs">
        <Kv k="Win rate" v="61%" />
        <Kv k="Avg hold" v="38m" />
        <Kv k="30d P/L" v="+212 SOL" good />
      </div>
      <div key={i} className="fade-up mt-5 flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald" />
        <div className="min-w-0">
          <div className="text-xs text-text">{a.k}</div>
          <div className="truncate text-xs text-muted">{a.v}</div>
        </div>
      </div>
    </PreviewFrame>
  );
}

/* ---------- Community: rewards, leaderboards, support ---------- */

export function CommunityVisual() {
  return (
    <PreviewFrame title="Rewards and leaderboard">
      <div className="rounded-lg border border-border bg-bg p-3">
        <div className="text-xs text-muted">Your referral link</div>
        <div className="mt-1 font-mono text-sm text-cyan">monexa.trade/r/k7m2</div>
        <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-xs">
          <Kv k="Referred" v="14" />
          <Kv k="Their volume" v="320 SOL" />
          <Kv k="Earned" v="0.48 SOL" good />
        </div>
      </div>
      <div className="mt-5 text-xs text-muted">Weekly leaderboard</div>
      <ol className="mt-2 divide-y divide-border">
        {[
          ["1", "9Qe2…Lm1", "+412 SOL"],
          ["2", "7xKp…3Fa", "+288 SOL"],
          ["3", "Bt4n…w8Z", "+197 SOL"],
          ["4", "Hm1c…Q2d", "+150 SOL"],
        ].map(([r, w, v], k) => (
          <li key={r} className="fade-up flex items-center justify-between py-2 font-mono text-xs" style={{ animationDelay: `${k * 70}ms` }}>
            <span className="flex items-center gap-3">
              <span className="w-4 text-muted">{r}</span>
              <span className="text-text-2">{w}</span>
            </span>
            <span className="text-positive">{v}</span>
          </li>
        ))}
      </ol>
    </PreviewFrame>
  );
}
