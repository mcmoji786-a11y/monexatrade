"use client";
/* "What if this rule had run yesterday?": the sniper's current settings run on the last
   24 hours of real launches (gateway /sniper/backtest, ai/backtest.py). Nothing is
   bought; it shows what would have happened, with what it could not replay. */
import { useState } from "react";
import Link from "next/link";
import { FlaskConical, Loader2 } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { tokenHref } from "@/lib/open-token";
import { useFeatures } from "@/lib/features";
import type { SniperSettings } from "@/lib/sniper";

type Pick = { mint: string; symbol: string; ret_pct: number; reason: string };
type Result = {
  ready: boolean;
  error?: string;
  coins?: number;
  from?: number;
  to?: number;
  trades?: number;
  wins?: number;
  win_rate?: number;
  total_usd?: number;
  spent_usd?: number;
  avg_pct?: number;
  best?: Pick[];
  worst?: Pick[];
  reasons?: Record<string, number>;
  curve?: [number, number][];
  notes?: string[];
};

export function SniperBacktest({ s, solUsd }: { s: SniperSettings; solUsd: number | null }) {
  const f = useFeatures();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!f.sniper_backtest) return null;

  const sizeUsd = s.buyUnit === "USD" ? s.buyUsd : solUsd ? s.buySol * solUsd : 25;
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${GATEWAY_HTTP}/sniper/backtest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...s, sizeUsd }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(text || `Test failed (${r.status})`);
      const v = JSON.parse(text) as Result;
      if (!v.ready) throw new Error(v.error ?? "The last 24 hours are still loading");
      setRes(v);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
    }
  };

  const up = (res?.total_usd ?? 0) >= 0;
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-sm text-text">
            <FlaskConical size={14} strokeWidth={1.5} className="text-muted" />
            Test these rules on yesterday
          </p>
          <p className="mt-0.5 text-xs text-muted">Your current settings, run on the last 24 hours of real launches. Nothing is bought</p>
        </div>
        <button type="button" onClick={run} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-60">
          {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
          {busy ? "Testing" : res ? "Test again" : "Run the test"}
        </button>
      </header>

      {err && <p className="px-4 py-4 text-sm text-text-2">{err}</p>}

      {res && !err && (
        <div key={res.to} className="fade-up flex flex-col gap-4 p-4">
          {!res.trades ? (
            <p className="text-sm text-text-2">
              No coin out of {res.coins?.toLocaleString()} passed these rules in the last 24 hours. Loosen a filter (max age, holders, AI) and test again
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fig k="Result" v={`${up ? "+" : "−"}$${Math.abs(res.total_usd ?? 0).toFixed(2)}`} tone={up ? "text-positive" : "text-negative"} sub={`on $${(res.spent_usd ?? 0).toLocaleString()} bought`} />
                <Fig k="Snipes" v={String(res.trades)} sub={`of ${res.coins?.toLocaleString()} launches`} />
                <Fig k="Win rate" v={`${res.win_rate}%`} sub={`${res.wins} won`} />
                <Fig k="Average" v={`${(res.avg_pct ?? 0) >= 0 ? "+" : ""}${res.avg_pct}%`} sub="per snipe, after costs" tone={(res.avg_pct ?? 0) >= 0 ? "text-positive" : "text-negative"} />
              </dl>
              {res.curve && res.curve.length > 1 && <Curve points={res.curve} up={up} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <Picks title="Best" list={res.best ?? []} />
                <Picks title="Worst" list={res.worst ?? []} />
              </div>
              {res.reasons && (
                <p className="font-mono text-xs text-muted">
                  {Object.entries(res.reasons)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, n]) => `${n} ${k}`)
                    .join(" · ")}
                </p>
              )}
            </>
          )}
          <ul className="flex flex-col gap-1 border-t border-border pt-3 text-[11px] leading-5 text-muted">
            {res.from && res.to && (
              <li>
                From {new Date(res.from * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} to {new Date(res.to * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}. Past results do not promise future ones
              </li>
            )}
            {res.notes?.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function Fig({ k, v, sub, tone = "text-text" }: { k: string; v: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg px-3 py-2.5">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`mt-1 font-mono text-lg ${tone}`}>{v}</dd>
      {sub && <dd className="text-[11px] text-muted">{sub}</dd>}
    </div>
  );
}

function Picks({ title, list }: { title: string; list: Pick[] }) {
  return (
    <div className="rounded-xl border border-border bg-bg">
      <p className="border-b border-border px-3 py-2 text-xs text-muted">{title}</p>
      <ul className="divide-y divide-border">
        {list.map((p) => (
          <li key={p.mint} className="flex items-center gap-2 px-3 py-2 text-sm">
            <Link href={tokenHref(p.mint)} className="min-w-0 flex-1 truncate text-text hover:underline">
              {p.symbol || `${p.mint.slice(0, 4)}…`}
            </Link>
            <span className="text-[11px] text-muted">{p.reason}</span>
            <span className={`w-16 text-right font-mono text-xs ${p.ret_pct >= 0 ? "text-positive" : "text-negative"}`}>
              {p.ret_pct >= 0 ? "+" : ""}
              {p.ret_pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Running result through the day. */
function Curve({ points, up }: { points: [number, number][]; up: boolean }) {
  const w = 600;
  const h = 120;
  const vals = [0, ...points.map((p) => p[1])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (vals.length - 1)) * w;
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (h - 12);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-28 w-full ${up ? "text-positive" : "text-negative"}`} preserveAspectRatio="none" role="img" aria-label="Running result through the day">
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />
      <path d={`${d}L${w},${y(0)}L0,${y(0)}Z`} fill="currentColor" opacity="0.08" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
