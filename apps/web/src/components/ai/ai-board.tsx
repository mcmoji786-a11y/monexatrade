"use client";
/* The Kixo AI page (gateway ai_risk.rs /ai/overview): ask the AI, let it trade for you on
   demo, see what it says about the newest coins and whether it has been right. Every
   number is real: live scores, outcomes measured from trades an hour later, and the
   model's own test on days it never saw. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { GATEWAY_HTTP, usd } from "@/lib/gateway";
import { pct, riskTitle, riskTone, type AiRisk } from "@/lib/ai-risk";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "@/components/token/token-bits";
import { StarButton } from "@/components/token/star-button";
import { QuickBuy } from "@/components/trade/quick-buy";
import { AiChatPanel } from "./ai-chat-panel";
import { CopyAiCard } from "./copy-ai-card";

type Group = { coins: number; dumped: number | null; doubled: number | null };
type Pick = { mint: string; symbol: string | null; name: string | null; image: string | null; mc_usd: number | null; dump: number; pump: number; at: number };
type Call = { mint: string; symbol: string; at: number; dump: number; pump: number; dumped: boolean; doubled: boolean; low_x: number; high_x: number };
type Target = { base_rate: number; auc: number; top10pct_rate: number; bottom10pct_rate: number };
type Overview = {
  on: boolean;
  service?: boolean;
  scored_1h?: number;
  scored_30m?: number;
  waiting?: number;
  riskiest?: Pick[];
  best?: Pick[];
  calls?: Call[];
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
            A model trained on {coins ? coins.toLocaleString() : "thousands of"} Solana launches judges every new coin from its first 2 minutes:
            the chance it falls 70%+, and the chance it doubles, within the hour after. Ask it, or let it trade for you on demo
          </p>
        </div>
        <dl className="grid w-full grid-cols-3 gap-x-4 sm:flex sm:w-auto sm:gap-x-10">
          <Figure label="Scored, last hour" value={data?.scored_1h?.toLocaleString() ?? "—"} accent />
          <Figure label="In their first 2 min" value={data?.waiting?.toLocaleString() ?? "—"} />
          <Figure label="Trained" value={trained ? trained.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} />
        </dl>
      </div>

      {/* Ask it, or let it trade */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <AiChatPanel overview={data} />
        <CopyAiCard />
      </div>

      {/* Has it been right? */}
      <TrackRecord track={data?.track} model={m ?? null} />

      {/* The newest scores, both ways, with their actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PickList title="Best 2x odds now" hint="Scored in the last 30 minutes, low dump risk, most likely to double first" picks={data?.best} now={now} empty="No low-risk coin scored in the last 30 minutes yet" />
        <PickList title="Highest dump risk now" hint="Scored in the last 30 minutes, most likely to fall 70%+ first" picks={data?.riskiest} now={now} empty="No coin with real dump risk scored in the last 30 minutes" />
      </div>

      <Calls calls={data?.calls} now={now} />

      <section className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-text-2">
        <h2 className="text-sm font-medium text-text">How to read it</h2>
        <ul className="mt-2 flex flex-col gap-1.5 leading-6">
          <li>Every new coin Kixo sees launch gets a score once its first 2 minutes are over. The same score shows on Sol Radar cards and the trade page</li>
          <li>The chances count from the price at 2 minutes. A coin that already crashed in its first 2 minutes can read low: it means no further 70% fall, not that the coin is good</li>
          <li>In testing, buying every coin the model liked still lost money after fees. Use it to stay away from danger, and prove any strategy on demo first</li>
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
  if (!now) return "";
  const s = Math.max(0, Math.round(now / 1000 - at));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
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
            <li key={p.mint} className="flex h-14 items-center gap-2.5 px-4 transition-colors hover:bg-surface-2">
              <Link href={tokenHref(p.mint)} className="flex min-w-0 flex-1 items-center gap-3">
                <TokenLogo src={p.image} symbol={p.symbol ?? "?"} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-text">{p.symbol || p.mint.slice(0, 6)}</span>
                  <span className="truncate font-mono text-[11px] text-muted">
                    {usd(p.mc_usd)} · scored {ago(now, p.at)} ago
                  </span>
                </span>
              </Link>
              <span className="hidden sm:flex">
                <Chip risk={{ dump: p.dump, pump: p.pump, trades: 0, at: p.at }} />
              </span>
              <StarButton mint={p.mint} size={14} />
              <QuickBuy mint={p.mint} symbol={p.symbol ?? ""} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The AI's strong calls from the last day and what really happened in their hour. */
function Calls({ calls, now }: { calls?: Call[]; now: number }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">The AI&apos;s recent calls</h2>
        <span className="text-xs text-muted">High dump risk or good 2x odds, checked an hour later</span>
      </div>
      {!calls || calls.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Calls show here one hour after they are made</p>
      ) : (
        <ul className="grid divide-y divide-border md:grid-cols-2 md:divide-y-0">
          {calls.map((c) => {
            const risky = c.dump >= 0.4;
            const right = risky ? c.dumped : c.doubled;
            const what = risky ? `fell ${Math.round((1 - c.low_x) * 100)}% at its low` : `rose ${Math.max(0, Math.round((c.high_x - 1) * 100))}% at its best`;
            return (
              <li key={`${c.mint}${c.at}`} className="flex h-14 items-center gap-3 px-4 md:border-b md:border-border">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${right ? "bg-positive/15 text-positive" : "bg-surface-3 text-muted"}`} title={right ? "The call came true" : "It did not happen"}>
                  {right ? <Check size={14} strokeWidth={1.5} /> : <X size={14} strokeWidth={1.5} />}
                </span>
                <Link href={tokenHref(c.mint)} className="flex min-w-0 flex-1 flex-col hover:underline">
                  <span className="truncate text-sm text-text">
                    {c.symbol || c.mint.slice(0, 6)}
                    <span className="ml-2 text-xs text-muted">{risky ? `said dump ${pct(c.dump)}` : `said 2x ${pct(c.pump)}`}</span>
                  </span>
                  <span className={`truncate font-mono text-[11px] ${right ? (risky ? "text-negative" : "text-positive") : "text-muted"}`}>
                    {what} · {ago(now, c.at)} ago
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
