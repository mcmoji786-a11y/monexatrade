"use client";
/* The Kixo AI page, for everyone: one plain promise at the top, the four words the AI
   answers in, and four tabs that each do one thing: see the AI's picks, check a coin,
   let the AI trade, or ask it. Every number is real (gateway ai_risk.rs /ai/overview). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useFeatures } from "@/lib/features";
import { Bot, Check, MessageCircle, ScanSearch, Sparkles, X } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { pct, verdict, VERDICTS, type AiRisk, type Verdict } from "@/lib/ai-risk";
import { answer, type ChatReply } from "@/lib/ai-chat";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "@/components/token/token-bits";
import { StarButton } from "@/components/token/star-button";
import { SafetyBadge } from "@/components/token/safety-badge";
import { QuickBuy } from "@/components/trade/quick-buy";
import { useRadarFeed } from "@/components/radar/use-radar-feed";
import { Tick } from "@/components/token/tick";
import { TokenCard } from "@/components/radar/token-card";
import { fromMarket } from "@/components/radar/radar-board";
import { newLaunchChecks } from "@/lib/risk";
import { useNow } from "@/components/radar/use-radar-feed";
import { AiChatPanel } from "./ai-chat-panel";
import { CopyAiCard } from "./copy-ai-card";

type Group = { coins: number; dumped: number | null; doubled: number | null };
/** A coin the AI scored, with where it is now against the price at the call (1 = unchanged). */
type Pick = {
  mint: string;
  symbol: string | null;
  name: string | null;
  image: string | null;
  mc_usd: number | null;
  holders?: number | null;
  launchpad?: string | null;
  now_x?: number | null;
  peak_x?: number | null;
  low_x?: number | null;
  /** A second-look pick: why, the minute it was picked, its chance of +50% before -25%,
   *  and true once +50% came. */
  why?: string[];
  ck?: number;
  win?: number;
  hit?: boolean | null;
  dump: number;
  pump: number;
  at: number;
};
type Call = { mint: string; symbol: string; at: number; dump: number; pump: number; dumped: boolean; doubled: boolean; low_x: number; high_x: number };
type Target = { base_rate: number; auc: number; top10pct_rate: number; bottom10pct_rate: number };
type Overview = {
  on: boolean;
  service?: boolean;
  scored_1h?: number;
  waiting?: number;
  riskiest?: Pick[];
  best?: Pick[];
  worth?: Pick[];
  strong?: { mint: string }[];
  ck_record?: { picks: number; hit_target: number; hit_stop: number; avg_result: number | null; ready: boolean };
  calls?: Call[];
  track?: { window_h: number; all: Group; high_dump: Group; low_dump: Group; high_pump: Group };
  model?: { trained: string | null; coins: number | null; targets: { dump: Target; pump: Target } | null; backtest?: Record<string, { trades: number }>; checkpoint?: CkModel | null } | null;
};

/** What the second-look model proved on days it never saw (train_checkpoint.py). */
type CkSummary = { trades: number; win_rate?: number; avg_return?: number };
type CkModel = { pick: { line: number; top: number; search: CkSummary; check: CkSummary } | null; every_alive_coin?: { search: CkSummary; check: CkSummary }; proven: boolean; test_coins?: number };

type Tab = "picks" | "check" | "auto" | "ask";
const TABS: { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: "picks", label: "AI picks", icon: Sparkles },
  { key: "check", label: "Check a coin", icon: ScanSearch },
  { key: "auto", label: "Auto trade", icon: Bot },
  { key: "ask", label: "Ask AI", icon: MessageCircle },
];

const POLL_MS = 10_000;
const riskOf = (p: { dump: number; pump: number; at: number }): AiRisk => ({ dump: p.dump, pump: p.pump, trades: 0, at: p.at });

export function AiBoard() {
  const aiAuto = useFeatures().ai_autotrade;
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const [tab, setTab] = useState<Tab>("picks");

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

  if (data && !data.on) return <p className="py-20 text-center text-sm text-text-2">Kixo AI is switched off right now</p>;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Hero data={data} failed={failed} />

      {/* One thing at a time */}
      <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Kixo AI">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors ${
              tab === key ? "border-emerald text-text" : "border-transparent text-text-2 hover:text-text"
            }`}
          >
            <Icon size={16} strokeWidth={1.5} />
            {label}
            {key === "auto" && !aiAuto && <span className="font-mono text-xs text-cyan">Soon</span>}
          </button>
        ))}
      </div>

      {tab === "picks" && <Picks data={data} now={now} />}
      {tab === "check" && <CheckCoin />}
      {tab === "auto" && <CopyAiCard />}
      {tab === "ask" && <AiChatPanel overview={data} />}
    </section>
  );
}

/** What it is, in one sentence, why to trust it, and the four words it answers in. */
function Hero({ data, failed }: { data: Overview | null; failed: boolean }) {
  const t = data?.model?.targets;
  const tr = data?.track;
  const liveDanger = tr && tr.high_dump.coins >= 20 && tr.high_dump.dumped != null ? tr.high_dump : null;
  const testCoins = data?.model?.backtest?.["every coin"]?.trades;
  const dangerRate = liveDanger ? liveDanger.dumped : (t?.dump.top10pct_rate ?? null);
  const baseRate = liveDanger ? tr!.all.dumped : (t?.dump.base_rate ?? null);
  const live = data?.service && !failed;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-medium text-text">Kixo AI</h1>
          <span className={`flex h-6 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-xs ${live ? "text-emerald" : "text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : failed ? "bg-negative" : "bg-muted"}`} />
            {live ? "Watching" : failed ? "Offline" : "Starting"}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-text-2">
          Kixo AI watches every new Solana coin for its first 2 minutes, then tells you in one word if it looks dangerous or promising
        </p>
      </div>

      {/* Why trust it: one number, compared with normal */}
      {dangerRate != null && baseRate != null && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-5 py-4">
          <p className="text-sm text-text">
            When Kixo AI said <span className="text-negative">Danger</span>, <span className="font-mono text-lg text-negative">{pct(dangerRate)}</span> of coins crashed within the hour.
            Normally it is <span className="font-mono text-text">{pct(baseRate)}</span>
          </p>
          <span className="text-xs text-muted">
            {liveDanger
              ? `Live, last 24 hours, ${tr!.all.coins.toLocaleString()} coins`
              : `Tested on ${testCoins ? testCoins.toLocaleString() : "thousands of"} coins it never saw${data?.model?.coins ? `, trained on ${data.model.coins.toLocaleString()}` : ""}`}
          </span>
        </div>
      )}

      {/* The four words */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(VERDICTS) as Verdict["key"][]).map((k) => (
          <div key={k} className="rounded-lg border border-border px-3 py-2.5">
            <span className={`inline-flex h-6 items-center rounded-full border px-2 text-xs ${VERDICTS[k].className}`}>{VERDICTS[k].label}</span>
            <p className="mt-1.5 text-xs leading-5 text-text-2">{VERDICTS[k].sentence}</p>
          </div>
        ))}
      </div>
    </div>
  );
}


function ago(now: number, at: number) {
  if (!now) return "";
  const s = Math.max(0, Math.round(now / 1000 - at));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

/** Tab 1: the coins to look at and the coins to avoid, then the AI's past calls. */
function Picks({ data, now }: { data: Overview | null; now: number }) {
  const good = (data?.best ?? []).filter((p) => verdict(riskOf(p)).key === "good");
  return (
    <div className="flex flex-col gap-4">
      <CoinList tone="good" title="AI picks: second look" hint="Coins Kixo AI looked at again at 5, 15 or 30 minutes and picked: the best chance of +50% before -25% within the hour" picks={data ? (data.worth ?? []) : undefined} now={now} empty="No coin passed Kixo AI's second look in the last hour. It only picks when the odds are tested to be real" />
      <SecondLookRecord data={data} />
      <CoinList tone="good" title="Good odds now" hint="Low crash risk and a real chance to double, still trading near or above the call" picks={data ? good.filter((g) => !(data.worth ?? []).some((w) => w.mint === g.mint)) : undefined} now={now} empty="No coin has Good odds right now. That is normal: no trade is a fine trade" />
      <StrongNow mints={data?.strong?.map((s) => s.mint)} />
      <p className="-mt-2 text-xs text-muted">Kixo AI can be wrong and most new memecoins go to zero. These are coins worth a closer look, not a promise. Not financial advice</p>
      <CoinList tone="bad" title="Danger now" hint="Best to stay away from these. See what happened since the call" picks={data?.riskiest?.filter((p) => p.dump >= 0.4)} now={now} empty="No coin marked Danger in the last 30 minutes" />
      <Calls calls={data?.calls} now={now} />
    </div>
  );
}

const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** The second look's honest record: what its pick line did on days the model never saw
 *  (after 1% cost each side), and how its live picks did in the last 24 hours. */
function SecondLookRecord({ data }: { data: Overview | null }) {
  const m = data?.model?.checkpoint;
  const live = data?.ck_record;
  if (!m?.pick) return null;
  const t = m.pick.check;
  const all = m.every_alive_coin?.check;
  return (
    <div className="-mt-2 flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-5 text-text-2">
      <p>
        Tested on days it never saw: its picks reached +50% before -25% <span className="font-mono text-text">{((t.win_rate ?? 0) * 100).toFixed(0)}%</span> of the time
        {all?.win_rate != null && <> (every coin alive at that minute: <span className="font-mono">{(all.win_rate * 100).toFixed(0)}%</span>)</>}, an average of{" "}
        <span className={`font-mono ${(t.avg_return ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{signedPct(t.avg_return ?? 0)}</span> per trade after fees, over {t.trades} trades
      </p>
      {live && live.picks > 0 && (
        <p>
          Live, last 24 hours: {live.picks} picks, {live.hit_target} reached +50%, {live.hit_stop} fell 25% first
          {live.avg_result != null && (
            <>
              , average <span className={`font-mono ${live.avg_result >= 0 ? "text-positive" : "text-negative"}`}>{signedPct(live.avg_result)}</span> after fees
            </>
          )}
        </p>
      )}
      {!m.proven && <p className="text-muted">Not yet proven to make money after fees on both test halves. Treat picks as coins to study, not to buy blindly</p>}
    </div>
  );
}

/** Change since the call, as a signed percent. */
const since = (x: number | null | undefined) => (x == null ? null : (x - 1) * 100);
const pctText = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}%`);
const pctTone = (v: number | null) => (v == null ? "text-muted" : v >= 0 ? "text-positive" : "text-negative");

/** The AI's picks as the same live coin cards as Sol Radar (picture, market cap,
 *  holders, trades, curve, safety, the AI chip), each with a line on what happened since
 *  the call. Only coins still live on the radar get a card, so every figure is current;
 *  the ones that left are counted, not shown half empty. */
function CoinList({ title, hint, picks, now: _now, empty, tone }: { title: string; hint: string; picks?: Pick[]; now: number; empty: string; tone: "good" | "bad" }) {
  void _now;
  const feed = useRadarFeed();
  const now = useNow();
  const live = (picks ?? []).map((p) => ({ p, t: feed.tokens.find((t) => t.mint === p.mint) })).filter((x): x is { p: Pick; t: NonNullable<typeof x.t> } => !!x.t);
  const gone = (picks?.length ?? 0) - live.length;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${tone === "good" ? "bg-positive" : "bg-negative"}`} aria-hidden="true" />
          <h2 className="text-base font-medium text-text">{title}</h2>
          {picks && <span className="font-mono text-xs text-muted">{live.length}</span>}
        </div>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      {!picks ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted">Loading</p>
      ) : live.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted">{picks.length ? `${empty}. ${gone} earlier ${gone === 1 ? "coin has" : "coins have"} gone quiet and left the radar` : empty}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {live.map(({ p, t }) => {
              const ch = since(p.now_x);
              const peak = since(p.peak_x);
              return (
                <div key={p.mint} className="coin-in flex min-w-0 flex-col">
                  <div className="flex items-center justify-between gap-3 whitespace-nowrap rounded-t-xl border border-b-0 border-border bg-surface-2 px-3 py-1.5 font-mono text-xs">
                    <span className="text-muted">
                      {p.ck ? `picked at ${Math.round(p.ck / 60)}m, ${ago(now, p.at)} ago · ${Math.round((p.win ?? 0) * 100)}% chance` : `called ${ago(now, p.at)} ago`}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted">
                        since call{" "}
                        <Tick value={ch} className={pctTone(ch)}>
                          {pctText(ch)}
                        </Tick>
                      </span>
                      <span className="text-muted">
                        peak <span className={pctTone(peak)}>{pctText(peak)}</span>
                      </span>
                    </span>
                  </div>
                  {p.why && p.why.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border border-y-0 border-border bg-surface-2 px-3 pb-2">
                      {p.why.slice(0, 4).map((w) => (
                        <span key={w} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-2">
                          {w}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="[&>*]:rounded-t-none">
                    <TokenCard
                      token={t}
                      alt={feed.markets[t.mint] ?? null}
                      smart={feed.smart[t.mint] ?? 0}
                      checks={newLaunchChecks(t, feed.markets[t.mint] ?? null, false, Math.floor(now / 1000))}
                      lowerRisk={false}
                      original={null}
                      sameSymbol={0}
                      xShare={null}
                      now={now}
                      repeated={false}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {gone > 0 && <p className="text-xs text-muted">{gone} more {gone === 1 ? "coin" : "coins"} from the last 30 minutes went quiet and left the radar</p>}
        </>
      )}
    </section>
  );
}

/** Established memecoins that look strong right now (the same check as the AI chat's
 *  best coins: real liquidity, organic trading, no mint authority, spread holders, a
 *  rising hour), as the same coin cards. */
function StrongNow({ mints }: { mints?: string[] }) {
  const feed = useRadarFeed();
  const now = useNow();
  const cards = (mints ?? []).map((m) => feed.markets[m]).filter((m): m is NonNullable<typeof m> => !!m);
  if (!mints || cards.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan" aria-hidden="true" />
          <h2 className="text-base font-medium text-text">Strong right now</h2>
          <span className="font-mono text-xs text-muted">{cards.length}</span>
        </div>
        <p className="text-xs text-muted">Older memecoins with real liquidity, organic trading and a rising hour</p>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {cards.map((m) => (
          <div key={m.mint} className="coin-in min-w-0">
            <TokenCard token={fromMarket(m)} alt={m} smart={feed.smart[m.mint] ?? 0} checks={[]} lowerRisk={false} original={null} sameSymbol={0} xShare={null} now={now} repeated={false} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The AI's past calls in plain sentences, checked an hour later. */
function Calls({ calls, now }: { calls?: Call[]; now: number }) {
  const list = (calls ?? []).filter((c) => c.dump >= 0.4 || verdict(riskOf(c)).key === "good");
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">Was the AI right?</h2>
        <p className="mt-0.5 text-xs text-muted">Its recent calls, checked one hour later</p>
      </div>
      {list.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted">Calls show here one hour after the AI makes them</p>
      ) : (
        <ul className="grid divide-y divide-border md:grid-cols-2 md:divide-y-0">
          {list.map((c) => {
            const danger = c.dump >= 0.4;
            const right = danger ? c.dumped : c.doubled;
            const happened = danger ? `it fell ${Math.round((1 - c.low_x) * 100)}%` : `it rose ${Math.max(0, Math.round((c.high_x - 1) * 100))}%`;
            return (
              <li key={`${c.mint}${c.at}`} className="flex h-14 items-center gap-3 px-4 md:border-b md:border-border">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${right ? "bg-positive/15 text-positive" : "bg-surface-3 text-muted"}`}>
                  {right ? <Check size={14} strokeWidth={1.5} aria-label="Right" /> : <X size={14} strokeWidth={1.5} aria-label="Not this time" />}
                </span>
                <Link href={tokenHref(c.mint)} className="min-w-0 flex-1 truncate text-sm text-text-2 hover:text-text">
                  <span className="text-text">{c.symbol || c.mint.slice(0, 6)}</span>: said <span className={danger ? "text-negative" : "text-positive"}>{danger ? "Danger" : "Good odds"}</span>, {happened}
                </Link>
                <span className="shrink-0 font-mono text-[11px] text-muted">{ago(now, c.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Tab 2: paste a coin, get one clear answer with the reasons and the actions. */
function CheckCoin() {
  const feed = useRadarFeed();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ChatReply | null>(null);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    const r = await answer(q.trim(), { tokens: feed.tokens, overview: null });
    setRes(r);
    setBusy(false);
  };

  const coin = res?.coins?.[0] ?? null;
  const v = coin?.risk ? verdict(coin.risk) : null;
  const reasons = (res?.text ?? []).filter((l) => !l.startsWith("Kixo AI says"));

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={check} className="flex gap-2">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-surface px-4 focus-within:border-emerald/50">
          <ScanSearch size={18} strokeWidth={1.5} className="shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Paste a coin address, or type $SYMBOL"
            aria-label="Coin to check"
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
        <button type="submit" disabled={busy || !q.trim()} className="h-12 shrink-0 rounded-xl bg-text px-5 text-sm font-medium text-bg transition-opacity disabled:opacity-50">
          {busy ? "Checking" : "Check"}
        </button>
      </form>

      {!res ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted">
          Paste any Solana coin. New coins get Kixo AI&apos;s word, older ones Kixo&apos;s safety score, each with the reasons
        </p>
      ) : !coin ? (
        <div className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-text-2">
          {res.text.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      ) : (
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-4">
            <TokenLogo src={coin.image} symbol={coin.symbol} size={48} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg text-text">{coin.symbol}</div>
              {coin.line && <div className="font-mono text-xs text-muted">{coin.line}</div>}
            </div>
            {v ? (
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <span className={`inline-flex h-9 items-center rounded-full border px-4 text-base font-medium ${v.className}`}>{v.label}</span>
                <span className="text-xs text-text-2">{v.sentence}</span>
              </div>
            ) : coin.safety ? (
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <span className="flex items-center gap-2 text-sm text-text-2">
                  Safety score <SafetyBadge safety={coin.safety} size="md" align="right" />
                </span>
                <span className="text-xs text-muted">
                  {coin.safety.level === "higher" ? "Fewer red flags" : coin.safety.level === "medium" ? "Some red flags" : "Many red flags"}. Not a guarantee
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted">No AI word yet</span>
            )}
          </div>
          <ul className="flex flex-col gap-2 px-5 py-4 text-sm leading-6 text-text-2">
            {reasons.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
                {l}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
            <Link href={tokenHref(coin.mint)} className="flex h-9 items-center rounded-lg border border-border px-3 text-sm text-text transition-colors hover:bg-surface-2">
              Open chart
            </Link>
            <QuickBuy mint={coin.mint} symbol={coin.symbol} />
            <StarButton mint={coin.mint} size={16} />
          </div>
        </section>
      )}
    </div>
  );
}
