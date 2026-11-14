"use client";
/* The Kixo AI page (gateway ai_risk.rs /ai/overview): what the model says about the newest
   coins, and whether it has been right. Every number is real: live scores, outcomes
   measured from trades an hour later, and the model's own test on days it never saw. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ScanSearch, ArrowUpRight } from "lucide-react";
import { GATEWAY_HTTP, usd } from "@/lib/gateway";
import { pct, riskTitle, riskTone, type AiRisk } from "@/lib/ai-risk";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "@/components/token/token-bits";

type Group = { coins: number; dumped: number | null; doubled: number | null };
type Pick = { mint: string; symbol: string | null; name: string | null; image: string | null; mc_usd: number | null; dump: number; pump: number; at: number };
type Target = { base_rate: number; auc: number; top10pct_rate: number; bottom10pct_rate: number };
type Overview = {
  on: boolean;
  service?: boolean;
  scored_1h?: number;
  scored_30m?: number;
  waiting?: number;
  riskiest?: Pick[];
  best?: Pick[];
  track?: { window_h: number; all: Group; high_dump: Group; low_dump: Group; high_pump: Group };
  model?: { trained: string | null; coins: number | null; targets: { dump: Target; pump: Target } | null } | null;
};

const POLL_MS = 10_000;

export function AiBoard() {
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  // Set with each load (never during render: the page is prerendered).
  const [now, setNow] = useState(0);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`${GATEWAY_HTTP}/ai/overview`, { cache: "no-store" });
        const v = (await r.json()) as Overview;
        if (!stop) {
          setData(v);
          setFailed(false);
          setNow(Date.now());
        }
      } catch {
        if (!stop) setFailed(true);
      }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (data && !data.on) {
    return <p className="py-20 text-center text-sm text-text-2">Kixo AI is switched off right now</p>;
  }

  const m = data?.model;
  const coins = m?.coins ?? null;
  const trained = m?.trained ? new Date(m.trained) : null;

  return (
    <section className="flex flex-col gap-6">
      {/* Title and the three figures that say the AI is working */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 basis-96">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text">Kixo AI</h1>
            <Status service={data?.service} failed={failed} loading={!data} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            A model trained on {coins ? coins.toLocaleString() : "thousands of"} Solana launches judges every new coin from its first 2 minutes of
            trades: the chance it falls 70% or more, and the chance it doubles, within the hour after
          </p>
        </div>
        <dl className="grid w-full grid-cols-3 gap-x-4 sm:flex sm:w-auto sm:gap-x-10">
          <Figure label="Scored, last hour" value={data?.scored_1h?.toLocaleString() ?? "—"} accent />
          <Figure label="In their first 2 min" value={data?.waiting?.toLocaleString() ?? "—"} />
          <Figure label="Trained" value={trained ? trained.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} />
        </dl>
      </div>

      {/* The one thing that matters: has it been right? */}
      <TrackRecord track={data?.track} model={m ?? null} />

      {/* The newest scores, both ways */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PickList
          title="Highest dump risk now"
          hint="Coins scored in the last 30 minutes, most likely to fall 70%+ first"
          picks={data?.riskiest}
          now={now}
          empty="No coin scored in the last 30 minutes yet"
        />
        <PickList
          title="Best 2x odds now"
          hint="Coins scored in the last 30 minutes with low dump risk, most likely to double first"
          picks={data?.best}
          now={now}
          empty="No low-risk coin scored in the last 30 minutes yet"
        />
      </div>

      <CheckCoin />

      <section className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-text-2">
        <h2 className="text-sm font-medium text-text">How to read it</h2>
        <ul className="mt-2 flex flex-col gap-1.5 leading-6">
          <li>Every new coin Kixo sees launch gets a score once its first 2 minutes are over. The same score shows on Sol Radar cards and the trade page</li>
          <li>The chances count from the price at 2 minutes. A coin that already crashed in its first 2 minutes can read low: it means no further 70% fall, not that the coin is good</li>
          <li>In testing, buying every coin the model liked still lost money after fees. Use it to stay away from danger, not as a signal to buy</li>
          <li>It is a model&apos;s estimate from past launches, not advice. The model is retrained as Kixo collects more data</li>
        </ul>
      </section>
    </section>
  );
}

function Status({ service, failed, loading }: { service?: boolean; failed: boolean; loading: boolean }) {
  const [text, dot, tone] = failed
    ? ["Offline", "bg-negative", "text-negative"]
    : loading
      ? ["Connecting", "bg-muted", "text-muted"]
      : service
        ? ["Live", "bg-emerald", "text-emerald"]
        : ["Starting", "bg-warning", "text-warning"];
  return (
    <span className={`flex h-6 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-xs ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-base tabular-nums sm:text-xl ${accent ? "text-emerald" : "text-text"}`}>{value}</dd>
    </div>
  );
}

/** Live: what really happened to scored coins within the hour, by what the AI said.
 *  Beside it, the model's test on days it never saw, so the two can be compared. */
function TrackRecord({ track, model }: { track?: Overview["track"]; model: Overview["model"] | null }) {
  const live = track && track.all.coins > 0;
  const t = model?.targets;
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-sm font-medium text-text">Has it been right?</h2>
        <span className="text-xs text-muted">How often coins really dumped 70%+ in the hour after their score</span>
      </div>
      <div className="grid gap-px bg-border md:grid-cols-2">
        <div className="bg-surface px-5 py-4">
          <h3 className="text-xs text-text-2">
            Live, last 24 hours <span className="font-mono text-muted">{live ? `${track.all.coins.toLocaleString()} coins` : ""}</span>
          </h3>
          {live ? (
            <div className="mt-3 flex flex-col gap-3">
              <Bar label="AI said high risk (40%+)" n={track.high_dump.coins} rate={track.high_dump.dumped} tone="bad" />
              <Bar label="Every scored coin" n={track.all.coins} rate={track.all.dumped} tone="base" />
              <Bar label="AI said low risk (under 10%)" n={track.low_dump.coins} rate={track.low_dump.dumped} tone="good" />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">The first results arrive one hour after the first scores: each coin is checked against what its price really did</p>
          )}
        </div>
        <div className="bg-surface px-5 py-4">
          <h3 className="text-xs text-text-2">Test on days the model never saw</h3>
          {t ? (
            <div className="mt-3 flex flex-col gap-3">
              <Bar label="AI's riskiest 10%" rate={t.dump.top10pct_rate} tone="bad" />
              <Bar label="Every coin" rate={t.dump.base_rate} tone="base" />
              <Bar label="AI's safest 10%" rate={t.dump.bottom10pct_rate} tone="good" />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Waiting for the AI service</p>
          )}
        </div>
      </div>
      {(live && track.high_pump.coins > 0) || t ? (
        <p className="border-t border-border px-5 py-3 text-xs text-text-2">
          Doubling:{" "}
          {live && track.high_pump.coins > 0 && track.high_pump.doubled != null && track.all.doubled != null && (
            <>
              live, coins with 20%+ 2x odds doubled <span className="font-mono text-positive">{pct(track.high_pump.doubled)}</span> of the time vs{" "}
              <span className="font-mono text-text">{pct(track.all.doubled)}</span> for all.{" "}
            </>
          )}
          {t && (
            <>
              In testing, the AI&apos;s top 10% doubled <span className="font-mono text-positive">{pct(t.pump.top10pct_rate)}</span> of the time vs{" "}
              <span className="font-mono text-text">{pct(t.pump.base_rate)}</span> for all
            </>
          )}
        </p>
      ) : null}
    </section>
  );
}

function Bar({ label, n, rate, tone }: { label: string; n?: number; rate: number | null; tone: "bad" | "good" | "base" }) {
  const color = tone === "bad" ? "bg-negative" : tone === "good" ? "bg-positive" : "bg-text-2";
  const text = tone === "bad" ? "text-negative" : tone === "good" ? "text-positive" : "text-text";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-text-2">
          {label}
          {n != null && <span className="ml-1.5 font-mono text-muted">{n.toLocaleString()}</span>}
        </span>
        <span className={`font-mono text-sm tabular-nums ${text}`}>{rate == null ? "—" : `${pct(rate)} dumped`}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(rate == null ? 0 : 1, (rate ?? 0) * 100)}%` }} />
      </div>
    </div>
  );
}

const TONE = {
  bad: "border-negative/40 bg-negative/10 text-negative",
  good: "border-positive/30 text-positive",
  muted: "border-border text-text-2",
} as const;

function Chip({ risk }: { risk: AiRisk }) {
  return (
    <span className={`flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[11px] ${TONE[riskTone(risk)]}`} title={riskTitle(risk)}>
      Dump {pct(risk.dump)}
      <span className="text-muted">·</span>
      2x {pct(risk.pump)}
    </span>
  );
}

function ago(now: number, at: number) {
  const s = Math.max(0, Math.round(now / 1000 - at));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

function PickList({ title, hint, picks, now, empty }: { title: string; hint: string; picks?: Pick[]; now: number; empty: string }) {
  return (
    <section className="flex flex-col rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </div>
      {!picks ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Loading</p>
      ) : picks.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {picks.map((p) => (
            <li key={p.mint}>
              <Link href={tokenHref(p.mint)} className="flex h-14 items-center gap-3 px-4 transition-colors hover:bg-surface-2">
                <TokenLogo src={p.image} symbol={p.symbol ?? "?"} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-text">{p.symbol || p.mint.slice(0, 6)}</span>
                  <span className="truncate font-mono text-[11px] text-muted">
                    {usd(p.mc_usd)} · scored {ago(now, p.at)} ago
                  </span>
                </span>
                <Chip risk={{ dump: p.dump, pump: p.pump, trades: 0, at: p.at }} />
                <ArrowUpRight size={14} strokeWidth={1.5} className="hidden shrink-0 text-muted sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Paste a coin's address: its AI score, if Kixo saw it launch. */
function CheckCoin() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ mint: string; risk: AiRisk | null; waiting: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    const mint = q.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
    setBusy(true);
    try {
      const r = await fetch(`${GATEWAY_HTTP}/ai/risk?mints=${mint}`, { cache: "no-store" });
      const v = (await r.json()) as { risk?: Record<string, AiRisk>; waiting?: number };
      setState({ mint, risk: v.risk?.[mint] ?? null, waiting: (v.waiting ?? 0) > 0 });
    } catch {
      setState(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-border bg-surface px-5 py-4">
      <h2 className="text-sm font-medium text-text">Check a coin</h2>
      <form onSubmit={check} className="mt-3 flex gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <ScanSearch size={16} strokeWidth={1.5} className="shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Paste a coin address"
            aria-label="Coin address"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-text outline-none placeholder:font-sans placeholder:text-muted"
          />
        </label>
        <button type="submit" disabled={busy} className="h-10 shrink-0 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity disabled:opacity-60">
          Check
        </button>
      </form>
      {state && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {state.risk ? (
            <>
              <Chip risk={state.risk} />
              <span className="text-text-2">from its first 2 minutes ({state.risk.trades} trades)</span>
              <Link href={tokenHref(state.mint)} className="text-cyan hover:underline">
                Open the coin
              </Link>
            </>
          ) : state.waiting ? (
            <span className="text-text-2">Still in its first 2 minutes. The score comes when they are over</span>
          ) : (
            <span className="text-text-2">No score: Kixo AI scores coins it saw launch since it started, from their first 2 minutes</span>
          )}
        </div>
      )}
    </section>
  );
}
