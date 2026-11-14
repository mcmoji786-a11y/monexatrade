"use client";
/* The Kixo AI page, for everyone: one plain promise at the top, the four words the AI
   answers in, and four tabs that each do one thing: see the AI's picks, check a coin,
   let the AI trade, or ask it. Every number is real (gateway ai_risk.rs /ai/overview). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Check, MessageCircle, ScanSearch, Sparkles, X } from "lucide-react";
import { GATEWAY_HTTP, usd } from "@/lib/gateway";
import { pct, riskTitle, verdict, VERDICTS, type AiRisk, type Verdict } from "@/lib/ai-risk";
import { answer, type ChatReply } from "@/lib/ai-chat";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "@/components/token/token-bits";
import { StarButton } from "@/components/token/star-button";
import { QuickBuy } from "@/components/trade/quick-buy";
import { useRadarFeed } from "@/components/radar/use-radar-feed";
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
  waiting?: number;
  riskiest?: Pick[];
  best?: Pick[];
  calls?: Call[];
  track?: { window_h: number; all: Group; high_dump: Group; low_dump: Group; high_pump: Group };
  model?: { trained: string | null; coins: number | null; targets: { dump: Target; pump: Target } | null; backtest?: Record<string, { trades: number }> } | null;
};

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
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
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
          <h1 className="text-2xl font-medium text-text">Kixo AI</h1>
          <span className={`flex h-6 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-xs ${live ? "text-emerald" : "text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : failed ? "bg-negative" : "bg-muted"}`} />
            {live ? "Watching" : failed ? "Offline" : "Starting"}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-base leading-7 text-text-2">
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

function VerdictPill({ risk }: { risk: AiRisk }) {
  const v = verdict(risk);
  return (
    <span className={`flex h-6 shrink-0 items-center rounded-full border px-2 text-xs ${v.className}`} title={riskTitle(risk)}>
      {v.label}
    </span>
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CoinList title="Good odds now" hint="Low crash risk and a real chance to double" picks={data ? good : undefined} now={now} empty="No coin has Good odds right now. That is normal: no trade is a fine trade" />
        <CoinList title="Danger now" hint="Best to stay away from these" picks={data?.riskiest?.filter((p) => p.dump >= 0.4)} now={now} empty="No coin marked Danger in the last 30 minutes" />
      </div>
      <Calls calls={data?.calls} now={now} />
    </div>
  );
}

function CoinList({ title, hint, picks, now, empty }: { title: string; hint: string; picks?: Pick[]; now: number; empty: string }) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </div>
      {!picks ? (
        <p className="px-4 py-10 text-center text-sm text-muted">Loading</p>
      ) : picks.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {picks.slice(0, 8).map((p) => (
            <li key={p.mint} className="flex h-14 items-center gap-2.5 px-4">
              <Link href={tokenHref(p.mint)} className="flex min-w-0 flex-1 items-center gap-3">
                <TokenLogo src={p.image} symbol={p.symbol ?? "?"} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-text hover:underline">{p.symbol || p.mint.slice(0, 6)}</span>
                  <span className="truncate font-mono text-[11px] text-muted">
                    {usd(p.mc_usd)} · {ago(now, p.at)} ago
                  </span>
                </span>
              </Link>
              <VerdictPill risk={riskOf(p)} />
              <StarButton mint={p.mint} size={14} />
              <QuickBuy mint={p.mint} symbol={p.symbol ?? ""} />
            </li>
          ))}
        </ul>
      )}
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
          Paste any new Solana coin. Kixo AI answers in one word, with the reasons, in a second
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
