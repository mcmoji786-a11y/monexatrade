"use client";
/* "AI analysis" on a coin (Discover, Sol Radar, trade page): Kixo AI's word for the coin,
   a written read from Kixo AI's language model (gateway ai_chat.rs) built only from the
   coin's live facts, Kixo's own checks, and a box to ask more about this coin. Without a
   model the read comes from Kixo's checks alone (lib/ai.ts quickRead). */
import { useFeatures } from "@/lib/features";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, Loader2, Sparkle, X } from "lucide-react";
import { analyze, type AnalysisInput, type AnalysisResult, type Numbers } from "@/lib/ai";
import { GATEWAY_HTTP, usd } from "@/lib/gateway";
import { askModel, looksSecret, plain, SECRET_REPLY } from "@/lib/ai-chat";
import { AI_WINDOW_S, pct, useAiRisk, verdict, type AiRisk } from "@/lib/ai-risk";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "./token-bits";
import { useNow } from "@/components/radar/use-radar-feed";
import { SCAN_STEPS, useLiveScan, type Finding, type Scan } from "./live-scan";
import type { Safety } from "@/lib/safety";

/** "AI" button on a coin. `compact` is the small table version. */
function AiButtonInner({ input, compact = false, safety }: { input: () => AnalysisInput; compact?: boolean; safety?: Safety | null }) {
  const [open, setOpen] = useState<AnalysisInput | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen({ ...input(), safety });
        }}
        title="Kixo AI analysis"
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cyan/30 text-xs text-cyan transition-colors hover:bg-cyan/10 focus-visible:outline-2 focus-visible:outline-emerald ${
          compact ? "h-8 px-2.5" : "h-8 px-3"
        }`}
      >
        <Sparkle size={13} strokeWidth={1.5} />
        {compact ? "AI" : "AI analysis"}
      </button>
      {open && <AiDialog input={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export type Tone = "bad" | "warn" | "good" | "muted";
const TONE: Record<Tone, string> = {
  bad: "border-negative/30 text-negative",
  warn: "border-warning/30 text-warning",
  good: "border-positive/30 text-positive",
  muted: "border-border text-text",
};

/** Kixo's own outlook and call for a coin, worked out in code so they are always clear and
 *  never contradict the data: the AI model's chances for a new launch, otherwise the
 *  safety score from Kixo's checks. */
export function outlook(risk: AiRisk | null, safety: Safety | null | undefined, ageSecs: number | null = null) {
  if (risk) {
    const v = verdict(risk);
    const call: [Tone, string] =
      v.key === "danger"
        ? ["bad", "Stay away. Most coins the AI calls Danger crash within the hour"]
        : v.key === "careful"
          ? ["warn", "Tiny size only, tight stop. Real crash risk"]
          : v.key === "good"
            ? ["good", "Cleaner than most, still risky. Small size and a stop loss"]
            : ["muted", "Nothing special either way. Skip it, or go tiny"];
    return {
      tone: (v.key === "danger" ? "bad" : v.key === "careful" ? "warn" : v.key === "good" ? "good" : "muted") as Tone,
      word: v.label,
      headline: `${pct(risk.dump)} chance it crashes 70%+ in the next hour, ${pct(risk.pump)} chance it doubles`,
      source: "Kixo AI, from this coin's first 2 minutes of trades",
      call,
    };
  }
  if (safety) {
    const worst = safety.factors.filter((f) => f.points < 0).sort((a, b) => a.points - b.points).slice(0, 2).map((f) => (f.detail ? `${f.label} (${f.detail})` : f.label));
    const level = safety.score >= 75 ? "Lower risk" : safety.score >= 50 ? "Medium risk" : "High risk";
    const tone: Tone = safety.score >= 75 ? "good" : safety.score >= 50 ? "warn" : "bad";
    const call: [Tone, string] =
      safety.score >= 75 ? ["good", "Cleaner than most, still risky. Small size and a stop loss"] : safety.score >= 50 ? ["warn", "Tiny size only, tight stop"] : ["bad", "Stay away. Too many red flags"];
    return {
      tone,
      word: level,
      headline: worst.length ? `Safety score ${safety.score}/100. Biggest risks: ${worst.join("; ")}` : `Safety score ${safety.score}/100, no red flags in Kixo's checks`,
      source:
        ageSecs != null && ageSecs < 180
          ? "Kixo's safety checks. Kixo AI adds its own score once the coin has 2 minutes of trades"
          : "Kixo's safety checks. Kixo AI scores coins in their first 2 minutes; this one is older",
      call,
    };
  }
  return null;
}

function Outlook({ risk, safety, num, sim, market }: { risk: AiRisk | null; safety: Safety | null | undefined; num?: Numbers; sim: Similar | undefined; market: MarketChances | null }) {
  const o = outlook(risk, safety, num?.ageSecs ?? null);
  if (!o) return null;
  const p = plan(o.tone, risk, safety, num, freshScore(num) ? scoreOf(sim) : null, market);
  const watching = !risk && num?.ageSecs != null && num.ageSecs < AI_WINDOW_S + 60;
  const reasons = plainReasons(safety, num);
  // "Out of 10 coins like this": past coins with the same AI scores when known, else the AI's own chances.
  // Launch-time odds only while they apply: an established coin gets the market forecast instead.
  const crash = market ? null : (sim?.similar.crashed ?? risk?.dump ?? null);
  const double = market ? null : (sim?.similar.doubled ?? risk?.pump ?? null);
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className={`rounded-xl border-2 px-4 py-4 ${TONE[p.tone]}`}>
        <p className="text-xs text-muted">Kixo says</p>
        <p className="mt-1 text-xl font-semibold">{p.title}</p>
        <p className="mt-1 text-sm text-text">{p.sub}</p>

        {crash != null && double != null && (
          <div className="mt-3 rounded-lg bg-surface px-3 py-2.5 text-sm text-text">
            <p className="text-xs text-muted">Out of 10 coins like this one, within an hour</p>
            <p className="mt-1">
              <span className="font-semibold text-negative">{outOf10(crash)} lose most of their value</span>
              <span className="text-muted"> · </span>
              <span className="font-semibold text-positive">{outOf10(double)} double</span>
            </p>
            {Math.round(crash * 10) + Math.round(double * 10) > 10 && <p className="mt-0.5 text-xs text-muted">Some do both: they double first, then crash</p>}
          </div>
        )}
        {watching && <Countdown launchedAt={num?.launchedAt ?? null} ageSecs={num!.ageSecs!} />}

        {reasons.bad.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted">Why</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm leading-6 text-text">
              {reasons.bad.map((r) => (
                <li key={r} className="flex gap-2">
                  <X size={14} strokeWidth={2} className="mt-1 shrink-0 text-negative" />
                  {r}
                </li>
              ))}
              {reasons.good.map((r) => (
                <li key={r} className="flex gap-2">
                  <Check size={14} strokeWidth={2} className="mt-1 shrink-0 text-positive" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {p.steps.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted">{p.stepsTitle}</p>
            <ol className="mt-1 flex flex-col gap-1 text-sm leading-6 text-text">
              {p.steps.map((st, i) => (
                <li key={st} className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-[11px] text-text-2">{i + 1}</span>
                  {st}
                </li>
              ))}
            </ol>
          </div>
        )}
        {p.watch && <p className="mt-3 text-[13px] text-text-2">Watch: {p.watch}</p>}
      </div>
    </div>
  );
}

/** "3 out of 10", from a share between 0 and 1. */
function outOf10(x: number) {
  const n = Math.round(x * 10);
  return n === 0 && x > 0 ? "Less than 1" : `${n}`;
}

/** The coin's main red flags (and good signs) in words a first-time trader understands,
 *  from the same checks as the safety score. Unknown data is left out. */
function plainReasons(safety: Safety | null | undefined, n?: Numbers) {
  const say: Record<string, (d?: string) => string> = {
    "Mint authority active": () => "The creator can print more coins at any time",
    "Freeze authority active": () => "The creator can freeze your coins so you cannot sell",
    "Top 10 wallets hold a lot": (d) => `Just 10 wallets own ${d ?? "a big share"} of it. If they sell, the price falls hard`,
    "Dev holds a lot": (d) => `The creator owns ${d ?? "a big share"}. If they sell, the price falls hard`,
    "Bundled wallets hold a share": (d) => `Wallets that bought together at launch own ${d ?? "a share"}. Often the creator's own`,
    "Early buyers (first 3 s) hold a share": (d) => `Bots that bought in the first seconds own ${d ?? "a share"} and usually sell fast`,
    "Dev sold everything": () => "The creator already sold everything and left",
    "Dev is selling": () => "The creator is selling right now",
    "Dev rugged before": (d) => `This creator ran off with buyers' money before (${d ?? "earlier coins"})`,
    "Dev's earlier coins died fast": () => "This creator's earlier coins died within minutes",
    "Copies an established coin's symbol": () => "It copies the name of a famous coin. Likely a fake",
    "Another new coin uses this symbol": () => "Other new coins use the same name. It may be a copy",
    "X account shared with other new coins": () => "Its X account is used by other new coins too. Likely a copy",
    "No social links": () => "No website, X or Telegram: nobody stands behind it",
    "Sells far outnumber buys": () => "Many more people are selling than buying",
    "Price crashed in 5 minutes": (d) => `The price fell ${d?.replace("-", "") ?? "a lot"} in the last 5 minutes`,
    "Liquidity under $5K": () => "Very little money in its pool: selling can cost you a lot",
    "Almost nobody holds it": () => "Almost nobody owns it yet",
    "Fewer than 25 holders": (d) => `Only ${d ?? "a few"} people own it so far`,
    "Under 2 minutes old: too new to judge": () => "It is brand new: too early to know if it is safe",
    "Very volatile": () => "The price is jumping up and down wildly",
    "Mostly bot trading": () => "Most of the trading looks like bots, not real people",
  };
  const bad = (safety?.factors ?? [])
    .filter((f) => f.points < 0 && say[f.label])
    .slice(0, 3)
    .map((f) => say[f.label](f.detail));
  const good: string[] = [];
  if (bad.length < 3) {
    for (const f of safety?.factors ?? []) {
      if (f.points > 0 && f.label === "Dev graduated coins before") good.push("This creator's earlier coins did well");
      if (f.points > 0 && f.label === "Verified token") good.push("It is a verified token");
    }
    if (n?.holders != null && n.holders >= 100) good.push(`${n.holders.toLocaleString()} people own it`);
  }
  return { bad, good: good.slice(0, 2) };
}

/** The safety-score read, for coins Kixo AI did not score (older or not yet). */
function SafetyRead({ risk, safety, num }: { risk: AiRisk | null; safety: Safety | null | undefined; num?: Numbers }) {
  const o = outlook(risk, safety, num?.ageSecs ?? null);
  if (!o) return null;
  return (
    <div className="rounded-lg border border-border bg-bg/60 px-4 py-3">
      <span className={`inline-flex h-7 items-center rounded-full border px-3 text-sm font-medium ${TONE[o.tone]}`}>{o.word}</span>
      <p className="mt-2 text-sm leading-6 text-text">{o.headline}</p>
      <p className="mt-1 text-xs text-muted">{o.source}</p>
    </div>
  );
}

/** Where each part of this analysis comes from, in plain words. */
function Sources({ ai }: { ai: boolean }) {
  return (
    <div className="mt-4 rounded-lg bg-surface px-3 py-2.5 text-xs leading-5 text-text-2">
      <p className="font-medium text-text">Where this comes from</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {ai && <li>Prediction: Kixo AI, trained by Kixo on hundreds of thousands of past Solana coins, reads this coin&apos;s first 2 minutes of trades</li>}
        {ai && <li>&quot;Coins like this one&quot;: what really happened to past coins with the same scores, from Kixo&apos;s own records</li>}
        <li>Warning signs: Kixo&apos;s safety checks on the coin&apos;s live trades, holders and creator history, read from the Solana blockchain</li>
        <li>Written read: a language model that only summarises this same data</li>
        <li>The decision at the top is worked out from all of the above by fixed rules, the same for every coin</li>
      </ul>
    </div>
  );
}

/** The first `n` sentences of a text. */
function firstSentences(t: string, n: number) {
  // A sentence ends at . ! or ? followed by a space: decimals like 4.9 stay whole.
  return t.split(/(?<=[.!?])\s+/).slice(0, n).join(" ").trim();
}

const SCAN_ICON: Record<Finding["tone"], { Icon: typeof Check; tone: string }> = {
  bad: { Icon: X, tone: "text-negative" },
  warn: { Icon: X, tone: "text-warning" },
  good: { Icon: Check, tone: "text-positive" },
  info: { Icon: Check, tone: "text-text-2" },
};

/** Kixo AI's live check of the coin: the checks while they run, then what it found (things
 *  the coin's page does not show) and the language model's short read built on them. */
function ScanCard({ scan, take }: { scan: Scan; take: string | null | "loading" }) {
  return (
    <section className="mb-4 rounded-xl border border-cyan/30 bg-bg/60 p-4">
      <p className="flex items-center gap-2 text-xs text-cyan">
        <Sparkle size={13} strokeWidth={1.5} />
        {scan.status === "scanning" ? "Kixo AI is checking this coin live" : "Kixo AI checked this coin just now"}
      </p>
      {scan.status === "scanning" && (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-text-2">
          {SCAN_STEPS.map((st) => (
            <li key={st} className="flex items-center gap-2">
              <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-cyan" />
              {st}
            </li>
          ))}
        </ul>
      )}
      {scan.status === "done" && scan.findings.length === 0 && <p className="mt-2 text-sm text-text-2">Nothing unusual in its holders and wallets right now.</p>}
      {scan.status === "done" && (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-6 text-text">
          {scan.findings.map((f) => {
            const { Icon, tone } = SCAN_ICON[f.tone];
            return (
              <li key={f.text} className="flex gap-2">
                <Icon size={14} strokeWidth={2} className={`mt-1 shrink-0 ${tone}`} />
                {f.text}
              </li>
            );
          })}
        </ul>
      )}
      {scan.status === "none" && <p className="mt-2 text-sm text-text-2">Kixo does not have this coin&apos;s holder data yet (it reads it for coins it watches from launch and for coins open on a trade page).</p>}
      {take === "loading" ? (
        scan.status !== "scanning" && (
          <p className="mt-3 flex items-center gap-2 text-sm text-text-2">
            <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
            Writing Kixo AI&apos;s read
          </p>
        )
      ) : take ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted">Kixo AI&apos;s read</p>
          <p className="mt-1 text-sm leading-6 text-text">{take}</p>
        </div>
      ) : null}
    </section>
  );
}

/** Kixo Buy Score, 0 to 100, from the average trade result of the closest past coins
 *  (gateway ai_risk.rs trade_result): 50 is break-even, every 1% better adds 8 points.
 *  Tested without look-ahead on 7,132 past coins (ai/buy_score_test.py, 2026-11-21):
 *  66+ really averaged +5.6% a trade (313 coins, 1% crashed), 35-65 -1.7%, under 35 -4.9%
 *  (12.9% crashed). */
export function buyScore(trade: number) {
  // Never 0 or 100: no memecoin is a sure thing either way.
  return Math.max(5, Math.min(95, Math.round(50 + 8 * trade * 100)));
}
const BUY_AT = 66;
/** The score was tested on buying when Kixo AI scored the coin: it holds for a few
 *  minutes after that, not for a coin bought much later. */
const FRESH_FOR_S = 300;
export function freshScore(num?: Numbers) {
  return num?.ageSecs != null && num.ageSecs < AI_WINDOW_S + FRESH_FOR_S;
}
const AVOID_UNDER = 35;
export function scoreOf(sim: Similar | undefined) {
  return sim?.similar.trade != null ? buyScore(sim.similar.trade) : null;
}

/** The Kixo Buy Score at the top of the analysis: how strongly Kixo recommends buying,
 *  as Buy X% / Avoid Y%, with what past coins like this one did. */
function BuyScore({ risk, sim, watching, fresh, ageSecs }: { risk: AiRisk | null; sim: Similar | undefined; watching: boolean; fresh: boolean; ageSecs: number | null }) {
  if (!risk) {
    return (
      <div className="mb-3 rounded-xl border border-border bg-bg/60 px-4 py-3 text-sm text-text-2">
        <span className="font-medium text-text">Kixo Buy Score</span>{" "}
        {watching ? "comes once Kixo AI has seen this coin's first 2 minutes" : "is made for new coins from their first 2 minutes; this one is older, so the read below uses its safety checks"}
      </div>
    );
  }
  const score = scoreOf(sim);
  if (sim === null || (sim && score == null)) {
    return <div className="mb-3 rounded-xl border border-border bg-bg/60 px-4 py-3 text-sm text-text-2">Kixo Buy Score: not enough past coins to compare yet</div>;
  }
  if (score == null || !sim) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-bg/60 px-4 py-3 text-sm text-text-2">
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-cyan" />
        Working out the Kixo Buy Score from past coins like this one
      </div>
    );
  }
  if (!fresh) {
    return (
      <div className="mb-3 rounded-xl border border-border bg-bg/60 px-4 py-3 text-sm text-text-2">
        <span className="font-medium text-text">Kixo Buy Score</span> was <span className="font-mono text-text">{score}/100</span> when Kixo AI scored this coin at about minute 2.
        That was a call for buying then; it is now {ageSecs != null ? `${Math.round(ageSecs / 60)} minutes` : "much"} later, so it no longer applies. The read below uses the coin&apos;s signs now.
      </div>
    );
  }
  const verdictText = score >= BUY_AT ? "Recommended: a small buy" : score < AVOID_UNDER ? "Avoid" : "Not recommended: no clear edge";
  const tone = score >= BUY_AT ? "text-positive border-positive/40" : score < AVOID_UNDER ? "text-negative border-negative/40" : "text-warning border-warning/40";
  const t = sim.similar.trade ?? 0;
  return (
    <div className={`mb-3 rounded-xl border-2 bg-bg/60 px-4 py-3 ${tone}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-text">Kixo Buy Score</span>
        <span className="font-mono text-2xl font-semibold">
          {score}
          <span className="text-sm text-muted">/100</span>
        </span>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <span className="h-full bg-positive" style={{ width: `${score}%` }} />
        <span className="h-full bg-negative/70" style={{ width: `${100 - score}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs">
        <span className="text-positive">Buy {score}%</span>
        <span className="text-negative">Avoid {100 - score}%</span>
      </div>
      <p className="mt-2 text-sm font-medium">{verdictText}</p>
      <p className="mt-1 text-xs leading-5 text-text-2">
        The {sim.similar.coins} past coins most like this one: an average trade {t >= 0 ? "made" : "lost"}{" "}
        <span className="font-mono">{Math.abs(t * 100).toFixed(1)}%</span>; {Math.round((sim.similar.good_buy ?? 0) * 100)} in 100 rose 50%+,{" "}
        {Math.round(sim.similar.crashed * 100)} in 100 crashed.
      </p>
      <p className="mt-1 text-[11px] text-muted">Checked on 7,132 past coins: scores of 66+ really made +5.6% a trade on average, scores under 35 lost 4.9%</p>
    </div>
  );
}

/** Kixo AI's next-hour chances for an established coin (gateway /ai/market, trained by
 *  ai/train_market.py on the market board's minute-by-minute history). */
export type MarketChances = { up10: number; up20: number; down10: number; down20: number; green: number };
type MarketForecastData = { chances: MarketChances; tested: { targets?: Record<string, { base_rate: number; auc: number }>; backtest?: Record<string, { trades: number; avg: number; win_rate: number }> } | null } | null;

export function useMarketForecast(mint: string, enabled: boolean) {
  const [state, setState] = useState<{ mint: string; v: MarketForecastData; done: boolean }>({ mint: "", v: null, done: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch(`${GATEWAY_HTTP}/ai/market?mint=${encodeURIComponent(mint)}`)
      .then((r) => (r.ok ? (r.json() as Promise<MarketForecastData>) : null))
      .then((v) => alive && setState({ mint, v, done: true }))
      .catch(() => alive && setState({ mint, v: null, done: true }));
    return () => {
      alive = false;
    };
  }, [mint, enabled]);
  if (!enabled) return { v: null, done: true };
  return state.mint === mint ? { v: state.v, done: state.done } : { v: null, done: false };
}

/** When the established-coin forecast leans up or says avoid. Checked on 3 unseen days with
 *  every coin, including the 7 in 10 that left the board within the hour (ai/market_check.py,
 *  2026-11-21): "avoid" (down10 50%+) really lost 5.4% a trade on 6,926 coins, solid; the
 *  "leans up" signal made only +0.6% a trade on 6,988 (+4.6% on coins that stayed on the
 *  board), a small edge, so it is never called a buy. */
const MARKET_BUY = { up10: 0.5, down10: 0.15 };
const MARKET_AVOID_DOWN10 = 0.5;

function marketCall(c: MarketChances) {
  if (c.up10 >= MARKET_BUY.up10 && c.down10 <= MARKET_BUY.down10) return "lean" as const;
  if (c.down10 >= MARKET_AVOID_DOWN10) return "avoid" as const;
  return "neutral" as const;
}

/** The forecast card for an established coin: the chances, against a typical coin. */
/** "about 3", or "almost none" under one in ten. */
function howMany(x: number) {
  return x < 0.05 ? "almost none" : `about ${Math.max(1, Math.round(x * 10))}`;
}

function MarketForecast({ data, loading }: { data: MarketForecastData; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-bg/60 px-4 py-3 text-sm text-text-2">
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-cyan" />
        Kixo AI is working out the next hour for this coin
      </div>
    );
  }
  if (!data) {
    return <div className="mb-3 rounded-xl border border-border bg-bg/60 px-4 py-3 text-sm text-text-2">Kixo AI&apos;s next-hour forecast is not available for this coin right now (it needs the coin on the live market board).</div>;
  }
  const c = data.chances;
  const call = marketCall(c);
  const base = (k: string) => data.tested?.targets?.[k]?.base_rate ?? null;
  const tone = call === "lean" ? "border-positive/40" : call === "avoid" ? "border-negative/40" : "border-border";
  const line = call === "lean" ? "Leans up for the next hour (small edge)" : call === "avoid" ? "Likely to fall in the next hour" : "No clear direction for the next hour";
  return (
    <div className={`mb-3 rounded-xl border-2 bg-bg/60 p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">Kixo AI forecast · next hour</span>
        <span className={`text-sm font-medium ${call === "lean" ? "text-positive" : call === "avoid" ? "text-negative" : "text-warning"}`}>{line}</span>
      </div>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <Chance label="Goes up 10%+" value={c.up10} avg={base("up10")} bar="bg-positive" />
        <Chance label="Falls 10%+" value={c.down10} avg={base("down10")} bar="bg-negative" />
        <Chance label="Goes up 20%+" value={c.up20} avg={base("up20")} bar="bg-positive" />
        <Chance label="Falls 20%+" value={c.down20} avg={base("down20")} bar="bg-negative" />
      </div>
      <p className="mt-3 text-sm text-text">
        In simple words: out of 10 hours like this one, <span className="font-semibold text-positive">{howMany(c.up10)}</span> see it rise 10%+ at some point and{" "}
        <span className="font-semibold text-negative">{howMany(c.down10)}</span> see it drop 10%+.
      </p>
      <p className="mt-1 text-[11px] text-muted">
        From the coin&apos;s live market figures and its last 30 minutes, by a model tested on days it never saw. On those days its &quot;likely to fall&quot; calls lost 5.4% a trade on average; its &quot;leans up&quot; calls made only about +0.6%. A forecast, not a promise
      </p>
    </div>
  );
}

type Similar = {
  similar: { coins: number; crashed: number; doubled: number; good_buy?: number; trade?: number; low_x: number; high_x: number; high_x_p75: number; low_x_p25: number };
  all: { coins: number; crashed: number; doubled: number; low_x: number; high_x: number };
} | null;

/** What happened to past coins with the same AI scores (gateway /ai/similar). */
export function useSimilar(risk: AiRisk | null) {
  const key = risk ? `${risk.dump.toFixed(3)}|${risk.pump.toFixed(3)}` : "";
  const [state, setState] = useState<{ key: string; v: Similar }>({ key: "", v: null });
  // undefined while it loads; null when there is no answer.
  useEffect(() => {
    if (!key) return;
    const [dump, pump] = key.split("|");
    let alive = true;
    fetch(`${GATEWAY_HTTP}/ai/similar?dump=${dump}&pump=${pump}`)
      .then((r) => (r.ok ? (r.json() as Promise<Similar>) : null))
      .then((v) => alive && setState({ key, v }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  return state.key === key ? state.v : key ? undefined : null;
}

const change = (x: number) => `${x >= 1 ? "+" : "−"}${Math.abs((x - 1) * 100).toFixed(0)}%`;

/** Kixo AI's own prediction for the next hour: its word, the crash and double chances
 *  against an average coin, what happened to past coins with the same scores, and the
 *  market cap range that follows from them. */
function Prediction({ risk, num }: { risk: AiRisk; num?: Numbers }) {
  const v = verdict(risk);
  const sim = useSimilar(risk);
  const tone = v.key === "danger" ? "border-negative/40" : v.key === "careful" ? "border-warning/40" : v.key === "good" ? "border-positive/40" : "border-border";
  // The past coins' moves start from the price when they were scored: the range in market
  // cap only holds while this coin is still near that moment.
  const mc = num?.mcUsd ?? null;
  const fresh = num?.ageSecs != null && num.ageSecs < AI_WINDOW_S + 6 * 60;
  return (
    <div className={`rounded-lg border bg-bg/60 p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">Kixo AI prediction · next hour</span>
        <span className={`inline-flex h-7 items-center rounded-full border px-3 text-sm font-medium ${v.className}`}>{v.label}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-text">{v.sentence}</p>

      <div className="mt-3 flex flex-col gap-2.5">
        <Chance label="Crashes 70% or more" value={risk.dump} avg={sim?.all.crashed ?? null} bar="bg-negative" />
        <Chance label="Doubles (2x)" value={risk.pump} avg={sim?.all.doubled ?? null} bar="bg-positive" />
      </div>

      {sim && (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5 text-xs leading-5 text-text-2">
          <p>
            The {sim.similar.coins} past coins with the closest scores (last 2 days):{" "}
            <span className="font-mono text-negative">{pct(sim.similar.crashed)}</span> crashed,{" "}
            <span className="font-mono text-positive">{pct(sim.similar.doubled)}</span> doubled. Typical hour: low{" "}
            <span className="font-mono text-text">{change(sim.similar.low_x)}</span>, high <span className="font-mono text-text">{change(sim.similar.high_x)}</span>.
          </p>
          {mc != null && fresh && (
            <p className="mt-1.5">
              Likely market cap within the hour: <span className="font-mono text-text">{usd(mc * sim.similar.low_x)}</span> to{" "}
              <span className="font-mono text-text">{usd(mc * sim.similar.high_x)}</span>; 1 in 4 went above{" "}
              <span className="font-mono text-text">{usd(mc * sim.similar.high_x_p75)}</span>.
            </p>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">From this coin&apos;s first 2 minutes ({risk.trades} trades). A prediction, not a promise</p>
    </div>
  );
}

function Chance({ label, value, avg, bar }: { label: string; value: number; avg: number | null; bar: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-text-2">{label}</span>
        <span className="font-mono text-text">
          {pct(value)}
          {avg != null && <span className="ml-1.5 text-[11px] text-muted">avg coin {pct(avg)}</span>}
        </span>
      </div>
      <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
        {avg != null && <span className="absolute top-0 h-full w-0.5 bg-text/70" style={{ left: `${Math.min(99, avg * 100)}%` }} title="Average coin" />}
      </div>
    </div>
  );
}

/** While Kixo AI is still watching the coin's first 2 minutes. */
function Countdown({ launchedAt, ageSecs }: { launchedAt: number | null; ageSecs: number }) {
  const now = useNow();
  const age = launchedAt != null && now ? now / 1000 - launchedAt : ageSecs;
  const left = Math.max(0, Math.ceil(AI_WINDOW_S - age));
  return (
    <div className="flex items-center gap-3 rounded-lg border border-cyan/30 bg-bg/60 px-4 py-3">
      <Loader2 size={16} strokeWidth={1.5} className="shrink-0 animate-spin text-cyan" />
      <p className="text-sm text-text">
        Kixo AI is watching this coin&apos;s first 2 minutes.{" "}
        {left > 0 ? (
          <>
            Prediction in about <span className="font-mono text-cyan">{left}s</span>
          </>
        ) : (
          "Prediction any moment now"
        )}
        <span className="block text-xs text-muted">This page updates by itself when it lands</span>
      </p>
    </div>
  );
}

/** Kixo's plan for the coin in plain words, worked out in code from the same data as the
 *  outlook so it never contradicts it: buy or not, how much, where to get out, and what
 *  would change the picture. Market cap levels are the real numbers for this coin. */
export function plan(tone: Tone, risk: AiRisk | null, safety: Safety | null | undefined, n?: Numbers, buy: number | null = null, market: MarketChances | null = null) {
  const mc = n?.mcUsd ?? null;
  const at = (x: number) => (mc ? ` (market cap ${usd(mc * x)})` : "");
  const young = n?.ageSecs != null && n.ageSecs < 120;
  const fewHolders = n?.holders != null && n.holders < 20;
  const falling = n?.change5m != null && n.change5m <= -30;
  const pumped = n?.change5m != null && n.change5m >= 100;
  const v = risk ? verdict(risk).key : null;
  const watch = n?.devSoldAll ? "" : "if the creator starts selling, sell at once";
  const ifBuy = (size: string, stop: number, take: number) => [
    `Use only ${size}: money you are fine losing`,
    `If it falls ${Math.round((1 - stop) * 100)}%, sell${at(stop)}`,
    `If it reaches ${take}x, sell at least half${at(take)}`,
  ];

  // Established coins: the next-hour forecast, tested on unseen days, decides when clear.
  if (market && marketCall(market) === "lean" && !n?.devSoldAll && tone !== "bad") {
    return { tone: "muted" as Tone, title: "Leans up, but only a small edge", sub: `Kixo AI sees a ${pct(market.up10)} chance it rises 10%+ within the hour and ${pct(market.down10)} that it drops 10%+. On past days such calls made only about +0.6% a trade`, stepsTitle: "If you buy", steps: ifBuy("a small amount (1 to 3% of your balance)", 0.9, 1.1).map((x) => x.replace("If it reaches 1.1x, sell at least half", "If it rises 10%, take your profit")), watch };
  }
  if (market && marketCall(market) === "avoid") {
    return { tone: "bad" as Tone, title: "Don't buy now", sub: `Kixo AI sees a ${pct(market.down10)} chance it drops 10%+ within the hour`, stepsTitle: "If you already own it", steps: ["Think about selling or setting a stop loss now", "Open this again later: the forecast updates every minute"], watch };
  }
  // The Kixo Buy Score, tested on thousands of past coins, decides when it is clear.
  if (buy != null && buy >= BUY_AT && !n?.devSoldAll) {
    return { tone: "good" as Tone, title: "Kixo recommends a small buy", sub: "Past coins like this one made money on average. Still a memecoin: only money you can lose", stepsTitle: "How to buy it", steps: ifBuy("a small amount (1 to 3% of your balance)", 0.6, 1.5), watch };
  }
  if (tone === "bad" || v === "danger" || n?.devSoldAll || (buy != null && buy < AVOID_UNDER)) {
    return {
      tone: "bad" as Tone,
      title: "Don't buy",
      sub: v === "danger" ? "High chance you lose most of your money within the hour" : "Too many warning signs on this coin",
      stepsTitle: "If you already own it",
      steps: ["Sell it, ideally on the next small rise", "Look for another coin: new ones launch every minute"],
      watch,
    };
  }
  if (young || fewHolders) {
    return {
      tone: "warn" as Tone,
      title: "Wait, don't buy yet",
      sub: young ? "It is too new: the next minutes show if it is safe" : "Too few people own it yet to tell",
      stepsTitle: "What to do",
      steps: ["Come back in a few minutes and open this again", "A good sign: 20+ people own it and the creator has not sold"],
      watch,
    };
  }
  if (falling) {
    return {
      tone: "warn" as Tone,
      title: "Wait, it is falling",
      sub: `Down ${Math.abs(n!.change5m!).toFixed(0)}% in 5 minutes. Buying a falling coin usually loses money`,
      stepsTitle: "What to do",
      steps: ["Wait until the price stops falling for a few minutes", "Then open this again"],
      watch,
    };
  }
  if (pumped) {
    return {
      tone: "warn" as Tone,
      title: "Too late for now",
      sub: `It already went up ${n!.change5m!.toFixed(0)}% in 5 minutes. Buying now often means buying the top`,
      stepsTitle: "What to do",
      steps: ["Wait for the price to cool down", "If you own it, this is a good moment to take some profit"],
      watch,
    };
  }
  if (tone === "good") {
    return { tone: "good" as Tone, title: "OK to try, with a small amount", sub: "Fewer warning signs than most coins. Still risky, like every memecoin", stepsTitle: "If you buy", steps: ifBuy("a small amount (1 to 3% of your balance)", 0.75, 2), watch };
  }
  if (tone === "warn") {
    return { tone: "warn" as Tone, title: "Risky: a very small amount, or skip", sub: "Some warning signs. Real chance of losing money", stepsTitle: "If you buy anyway", steps: ifBuy("a very small amount (about 1% of your balance)", 0.8, 1.5), watch };
  }
  return { tone: "muted" as Tone, title: "Nothing special: better to skip", sub: "No strong reason to buy it", stepsTitle: "If you buy anyway", steps: ifBuy("a small amount", 0.8, 1.5), watch };
}

/** The question sent to the model: the coin's live facts only, and the shape of the answer. */
function prompt(input: AnalysisInput, risk: AiRisk | null, scan: Finding[] = [], buy: number | null = null, market: MarketChances | null = null) {
  const o = outlook(risk, input.safety, input.num?.ageSecs ?? null);
  const decision = o ? plan(o.tone, risk, input.safety, input.num, buy, market).title : null;
  const facts = input.facts.map((f) => `${f.label}: ${f.value}`).join("; ");
  const s = input.safety;
  const flags = s ? s.factors.filter((f) => f.points < 0).slice(0, 6).map((f) => (f.detail ? `${f.label} (${f.detail})` : f.label)).join("; ") : "";
  const v = risk ? verdict(risk) : null;
  return [
    `Analyse the Solana coin ${input.symbol} (${input.name}), address ${input.mint}, for a trader deciding whether to look closer.`,
    `Live facts: ${facts}.`,
    s ? `Kixo safety score ${s.score}/100.${flags ? ` Flags: ${flags}.` : " No red flags."}` : "",
    v && risk ? `Kixo AI word: ${v.label} (crash chance ${pct(risk.dump)}, double chance ${pct(risk.pump)}, from its first 2 minutes).` : "",
    decision ? `Kixo's decision for this coin is: "${decision}". Your read must agree with it: never suggest buying, aping or a stop loss when it says not to buy or to wait.` : "",
    market ? `Kixo AI's next-hour forecast for this coin: ${pct(market.up10)} chance it rises 10%+, ${pct(market.up20)} that it rises 20%+, ${pct(market.down10)} that it falls 10%+, ${pct(market.down20)} that it falls 20%+. Use these exact chances.` : "",
    scan.length ? `Kixo's live scan of this coin's holders and wallets, just now: ${scan.map((f) => f.text).join("; ")}. This is the newest and most specific information: build the quick take on it.` : "",
    `Use only these facts and the LIVE DATA (holders, dev position, bundlers, snipers, the dev's wallet and history). Do not repeat the address. Talk like a friendly guide to someone buying their first memecoin: simple everyday English, short sentences, no trading jargon (if you must use a word like liquidity or bundle, explain it in a few words). Write chances as whole percentages only (like 17%), never as decimals.`,
    `Answer in plain text, one item per line, every line starting with its label:`,
    `Quick take: 2 short sentences on what is special about this coin right now and what it means for someone thinking of buying, using the live scan.`,
    `Good: one strength per line, up to 3 lines, each with the real number.`,
    `Bad: one risk per line, up to 3 lines, each with the real number (dev selling, bundlers or snipers holding, top 10 share, dev's past rugs).`,
    `Rules for you, never repeat them: top 10 holders under 20% is healthy (Good), over 30% is a risk (Bad). Liquidity under $10K is thin (Bad), over $50K is decent (Good). Bundles or snipers still holding over 10% is a risk. Kixo's safety score: 75 or more is good, under 50 is a risk (a low score is never a strength). A fact goes in Good or in Bad, never both, and never contradict yourself. The live facts above come first: if LIVE DATA disagrees or is missing, trust the live facts. Never list missing or unknown data as a strength or a risk; just leave it out. With fewer than 10 holders, holder shares (top 10, dev, early buyers) mean nothing yet: never list them as Good.`,
    `Do not write a prediction or a call: Kixo adds those itself.`,
  ]
    .filter(Boolean)
    .join("\n");
}

type Turn = { q: string; a: string[] };

function AiDialog({ input, onClose }: { input: AnalysisInput; onClose: () => void }) {
  const risk = useAiRisk(input.mint);
  const scan = useLiveScan(input.mint);
  const sim = useSimilar(risk);
  const watching = !risk && input.num?.ageSecs != null && input.num.ageSecs < AI_WINDOW_S + 60;
  // Established coins (no launch score, or one too old to apply): the market forecast.
  const established = !watching && (!risk || !freshScore(input.num));
  const market = useMarketForecast(input.mint, established);
  const [rules, setRules] = useState<AnalysisResult | null>(null);
  const [read, setRead] = useState<string[] | null | "loading">("loading");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Kixo's own checks, always ready.
  useEffect(() => {
    let alive = true;
    analyze(input).then((r) => alive && setRules(r));
    return () => {
      alive = false;
    };
  }, [input]);

  // The model's read, once, after the live scan so it can build on it. The AI word is
  // included when it is already known.
  useEffect(() => {
    if (asked.current || scan.status === "scanning" || (risk && sim === undefined) || !market.done) return;
    asked.current = true;
    askModel(prompt(input, risk, scan.findings, freshScore(input.num) ? scoreOf(sim) : null, established ? market.v?.chances ?? null : null), []).then((r) => setRead(r && "reply" in r ? plain(r.reply).split(/\n+/).map((l) => l.trim()).filter(Boolean) : null));
  }, [input, risk, scan, sim, market, established]);

  const follow = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setQ("");
    if (looksSecret(text)) {
      setTurns((t) => [...t, { q: "(hidden)", a: SECRET_REPLY.text }]);
      return;
    }
    setBusy(true);
    const history = [
      { role: "user" as const, content: prompt(input, risk) },
      { role: "assistant" as const, content: Array.isArray(read) ? read.join("\n") : "" },
      ...turns.flatMap((t) => [
        { role: "user" as const, content: t.q },
        { role: "assistant" as const, content: t.a.join("\n") },
      ]),
    ];
    const r = await askModel(`About ${input.symbol} (${input.mint}): ${text}`, history);
    const a = r && "reply" in r ? plain(r.reply).split(/\n+/).map((l) => l.trim()).filter(Boolean) : r && "refused" in r ? SECRET_REPLY.text : ["Kixo AI is busy right now. Try again in a minute"];
    setTurns((t) => [...t, { q: text, a }]);
    setBusy(false);
  };


  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16 font-sans"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-title"
        onClick={(e) => e.stopPropagation()}
        className="fade-up flex max-h-[85vh] w-full max-w-xl cursor-default flex-col overflow-hidden rounded-xl border border-border bg-surface text-left shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border p-5">
          <TokenLogo src={input.image} symbol={input.symbol} size={40} />
          <div className="min-w-0 flex-1">
            <h2 id="ai-title" className="flex items-center gap-2 text-base font-medium text-text">
              <Sparkle size={15} strokeWidth={1.5} className="text-cyan" />
              Kixo AI analysis
            </h2>
            <p className="truncate text-sm text-text-2">
              {input.symbol} · {input.name}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* Kixo's outlook and call, from the AI model or the safety checks */}
          {established ? <MarketForecast data={market.v} loading={!market.done} /> : <BuyScore risk={risk} sim={sim} watching={watching} fresh={freshScore(input.num)} ageSecs={input.num?.ageSecs ?? null} />}
          <Outlook risk={risk} safety={input.safety} num={input.num} sim={sim} market={established ? market.v?.chances ?? null : null} />

          {/* What Kixo AI found when it checked this coin just now, and its short read */}
          <ScanCard scan={scan} take={read === "loading" ? "loading" : Array.isArray(read) ? firstSentences(parseRead(read).take.join(" "), 2) : null} />

          {/* For traders who want the numbers: the prediction, the written read, the data and where it comes from */}
          <details className="group mt-4 rounded-lg border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-text-2 hover:text-text">
              More details
              <span className="text-xs text-muted group-open:hidden">numbers, Kixo AI&apos;s full read, sources</span>
            </summary>
            <div className="border-t border-border px-4 pt-4 pb-4">
              {risk ? <Prediction risk={risk} num={input.num} /> : <SafetyRead risk={risk} safety={input.safety} num={input.num} />}
              <div className="mt-4">
            {/* The written read */}
            {read === "loading" ? (
              <p className="flex items-center gap-2 text-sm text-text-2">
                <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                Kixo AI is reading this coin&apos;s live data
              </p>
            ) : read ? (
              <Read lines={read} holders={input.num?.holders ?? null} />
            ) : rules?.status === "ok" ? (
              <div className="flex flex-col gap-4 text-sm">
                <p className="leading-6 text-text">{rules.summary}</p>
                <Section title="Strengths" tone="text-positive" items={rules.strengths} />
                <Section title="Risks" tone="text-negative" items={rules.risks} />
                <Section title="What to watch" tone="text-warning" items={rules.watch} />
              </div>
            ) : (
              <p className="text-sm text-text-2">Kixo AI is busy right now. The live data is below</p>
            )}
              </div>
            <h3 className="mt-5 text-xs text-muted">Live data the analysis uses</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {input.facts.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[11px] text-muted">{f.label}</dt>
                  <dd className="truncate font-mono text-xs text-text">{f.value}</dd>
                </div>
              ))}
            </dl>
              <Sources ai={!!risk} />
            </div>
          </details>

          {/* Ask more about this coin */}
          {turns.map((t, i) => (
            <div key={i} className="mt-4 flex flex-col gap-2">
              <p className="self-end rounded-xl rounded-br-sm bg-surface-3 px-3 py-2 text-sm text-text">{t.q}</p>
              <div className="rounded-xl rounded-bl-sm border border-border bg-bg px-3 py-2 text-sm leading-6 text-text-2">
                {t.a.map((l, j) => (
                  <p key={j}>{l}</p>
                ))}
              </div>
            </div>
          ))}
          <form onSubmit={follow} className="mt-4 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Ask anything about ${input.symbol}`}
              aria-label={`Ask Kixo AI about ${input.symbol}`}
              maxLength={300}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
            />
            <button type="submit" disabled={busy || !q.trim()} aria-label="Ask" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-text text-bg transition-opacity disabled:opacity-40">
              {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={1.5} />}
            </button>
          </form>

        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[11px] text-muted">
          <span>Kixo AI can be wrong. Not financial advice</span>
          <Link href={tokenHref(input.mint)} onClick={onClose} className="text-cyan hover:underline">
            Open chart
          </Link>
        </div>
      </div>
    </div>
  );
}

type Part = "take" | "good" | "bad" | "prediction" | "call";
const LABEL: [RegExp, Part][] = [
  [/^quick take$/i, "take"],
  [/^(good|strengths?)$/i, "good"],
  [/^(bad|risks?)$/i, "bad"],
  [/^(prediction|next hour|watch)$/i, "prediction"],
  [/^(call|recommendation)$/i, "call"],
];

/** The model's read, line by line ("Good: …"), sorted into its parts. Lines without a
 *  known label belong to the part above them (the quick take at the start). */
export function parseRead(lines: string[]) {
  const out: Record<Part, string[]> = { take: [], good: [], bad: [], prediction: [], call: [] };
  let part: Part = "take";
  for (const raw of lines) {
    const l = raw.replace(/^[-•*]\s*/, "");
    const m = l.match(/^([A-Za-z ]{2,20}):\s*(.*)$/);
    const hit = m ? LABEL.find(([re]) => re.test(m[1].trim())) : undefined;
    if (hit && m) {
      part = hit[1];
      if (m[2].trim()) out[part].push(m[2].trim());
    } else if (m) {
      // A label we did not ask for (the model echoing instructions): left out.
      continue;
    } else if (l.trim()) {
      out[part].push(l.trim());
    }
  }
  // Missing data is neither a strength nor a risk.
  const unknown = /unknown|can'?t verify|no (info|data)|not available/i;
  out.good = out.good.filter((x) => !unknown.test(x));
  out.bad = out.bad.filter((x) => !unknown.test(x));
  return out;
}

/** The model's written read: the quick take, the good and the bad. The outlook and the call
 *  come from Kixo itself (Outlook), so anything the model adds there is left out. */
function Read({ lines, holders }: { lines: string[]; holders: number | null }) {
  const r = parseRead(lines);
  // With a handful of holders, holder shares say nothing: never shown as a strength.
  if (holders != null && holders < 10) r.good = r.good.filter((x) => !/top.?10|dev (holds|wallet)|of (the )?supply|holder/i.test(x));
  return (
    <div className="flex flex-col gap-4 text-sm leading-6">
      {/* The quick take is shown above, in the live scan card. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Points title="Good" icon={Check} tone="text-positive" items={r.good} />
        <Points title="Bad" icon={X} tone="text-negative" items={r.bad} />
      </div>
    </div>
  );
}

function Points({ title, icon: Icon, tone, items }: { title: string; icon: typeof Check; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className={`text-xs ${tone}`}>{title}</h3>
      <ul className="mt-1.5 flex flex-col gap-1.5 text-text-2">
        {items.map((x) => (
          <li key={x} className="flex gap-2">
            <Icon size={14} strokeWidth={1.5} className={`mt-1 shrink-0 ${tone}`} />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className={`text-xs ${tone}`}>{title}</h3>
      <ul className="mt-1.5 flex flex-col gap-1 text-text-2">
        {items.map((x) => (
          <li key={x} className="flex gap-2">
            <span className={`mt-2 h-1 w-1 shrink-0 rounded-full bg-current ${tone}`} />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Hidden when the admin switches "ai_analysis" off (lib/features.ts). */
export function AiButton(props: { input: () => AnalysisInput; compact?: boolean; safety?: Safety | null }) {
  const f = useFeatures();
  return f.ai_analysis ? <AiButtonInner {...props} /> : null;
}
