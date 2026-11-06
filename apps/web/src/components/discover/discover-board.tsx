"use client";
import { TradeLink } from "@/components/token/trade-link";

import Link from "next/link";
import { tokenHref, useOpenToken } from "@/lib/open-token";
import { Socials } from "@/components/token/socials";
import { AiButton } from "@/components/token/ai-analysis";
import { Sparkline } from "@/components/token/sparkline";
import { SafetyBadge } from "@/components/token/safety-badge";
import { rowSignals, safetyScore, type Safety } from "@/lib/safety";
import type { FeedToken } from "@/lib/gateway";
import { inputFromRow } from "@/lib/ai";

import { useDeferredValue, useMemo, useState } from "react";
import { Activity, BadgeCheck, Crosshair, Flame, ShieldCheck, Star, TrendingUp, type LucideIcon } from "lucide-react";
import { useDiscoverFilters, useWatchlist } from "@/lib/prefs";
import { DiscoverFiltersMenu, passesDiscover } from "./discover-filters";
import { StarButton } from "@/components/token/star-button";
import { buildRows, CATEGORIES, changeIn, rank, rowRisk, volIn, WINDOWS, type Category, type DiscoverRow, type MetricKey, type Window } from "@/lib/categories";
import { amount, pct, price, usd } from "@/lib/gateway";
import { formatAge, useNow, useRadarFeed, type FeedStatus } from "@/components/radar/use-radar-feed";
import { CopyMint, TokenLogo } from "@/components/token/token-bits";
import { Tick } from "@/components/token/tick";
import { age, changeTone, Move, SourceTag, TokenTable } from "./token-table";

const ICONS: Record<string, LucideIcon> = {
  trending: Flame,
  gainers: TrendingUp,
  sniped: Crosshair,
  active: Activity,
  "lower-risk": ShieldCheck,
  watchlist: Star,
};

/** The figure a category ranks by: raw value (for the flash), text, colour and unit. */
function figure(metric: MetricKey, r: DiscoverRow, w: Window = "1h") {
  switch (metric) {
    case "volume5m": {
      const v = volIn(r, w);
      return { raw: v, value: usd(v), tone: "text-text", unit: `traded in ${w}` };
    }
    case "change1h": {
      const c = changeIn(r, w);
      return { raw: c, value: pct(c), tone: changeTone(c), unit: `in ${w}` };
    }
    case "snipers":
      return { raw: r.sniperPct, value: `${(r.sniperPct ?? 0).toFixed(1)}%`, tone: "text-text", unit: `held by ${r.snipers ?? 0} early buyers` };
    case "risk": {
      const s = rowRisk(r);
      return { raw: s, value: `${s}/100`, tone: "text-text", unit: "red-flag score, lower is calmer" };
    }
    case "trades": {
      const n = (r.buys1h ?? 0) + (r.sells1h ?? 0);
      return { raw: n, value: n.toLocaleString(), tone: "text-text", unit: "trades in 1h" };
    }
  }
}

/** Discover: tokens across Solana ranked into four categories, updating live. */
export function DiscoverBoard() {
  // Live data renders at low priority: clicks and navigation always come first.
  const feed = useDeferredValue(useRadarFeed());
  const { tokens, markets, solUsd, sparks, smart, status, updatedAt } = feed;
  const launches = useMemo(() => new Map(tokens.map((t) => [t.mint, t])), [tokens]);
  const now = useDeferredValue(useNow());
  const [active, setActive] = useState(CATEGORIES[0].key);
  const [win, setWin] = useState<Window>("5m");
  const watch = useWatchlist().mints;
  // Starred coins, in the order they were starred.
  const cats = useMemo<Category[]>(
    () => [
      ...CATEGORIES,
      {
        key: "watchlist",
        label: "Watchlist",
        description: "Coins you starred, newest star first. Saved in this browser",
        metric: "trades",
        include: (r) => watch.includes(r.mint),
        score: (r) => -watch.indexOf(r.mint),
      },
    ],
    [watch],
  );

  const { filters: dfilters } = useDiscoverFilters();
  const minute = Math.floor(now / 60_000);
  const rows = useMemo(
    () => buildRows(tokens, markets, solUsd).filter((r) => passesDiscover(r, dfilters, minute * 60)),
    [tokens, markets, solUsd, dfilters, minute],
  );
  const ranked = useMemo(
    () => Object.fromEntries(cats.map((c) => [c.key, rank(rows, c, win)])) as Record<string, DiscoverRow[]>,
    [rows, cats, win],
  );
  const cat = cats.find((c) => c.key === active) ?? cats[0];
  const volume1h = rows.reduce((s, r) => s + (r.vol1hUsd ?? 0), 0);
  const latest = useMemo(() => [...tokens].sort((a, b) => b.timestamp - a.timestamp).slice(0, 12), [tokens]);

  return (
    <section>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text md:text-3xl">Discover</h1>
            <LiveBadge status={status} updatedAt={updatedAt} now={now} />
            <DiscoverFiltersMenu />
          </div>
          <p className="mt-1.5 text-sm text-text-2">Solana memecoins moving right now, updated live</p>
        </div>
        <dl className="grid grid-cols-3 gap-x-8 gap-y-3">
          <Stat label="Tokens" value={String(rows.length)} />
          <Stat label="Volume 1h" value={usd(volume1h)} raw={volume1h} />
          <Stat label="SOL" value={solUsd ? `$${solUsd.toFixed(2)}` : "—"} raw={solUsd} />
        </dl>
      </div>

      {/* Category selector */}
      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" role="tablist" aria-label="Categories">
        {cats.map((c) => (
          <CategoryTile key={c.key} cat={c} on={c.key === cat.key} count={ranked[c.key].length} onClick={() => setActive(c.key)} />
        ))}
      </div>

      <JustLaunched tokens={latest} now={now} />

      <CategoryView key={cat.key} cat={cat} list={ranked[cat.key]} now={now} status={status} sparks={sparks} win={win} setWin={setWin} launches={launches} smart={smart} />

      <p className="mt-6 max-w-3xl text-xs leading-5 text-muted">
        Memecoins only: tokens tagged meme or launched on a memecoin launchpad. Stocks, RWAs and DeFi tokens are
        excluded. Prices for new launches are computed by MONEXA from every trade. Holders, liquidity and
        established tokens come from market data and refresh every few seconds. Holder counts marked ~ are estimates
        until exact counts load. Being listed is not a recommendation.
      </p>
    </section>
  );
}

/** One category's ranking. Keyed by category so rank movement starts fresh on switch. */
function CategoryView({
  cat,
  list,
  now,
  status,
  sparks,
  win,
  setWin,
  launches,
  smart,
}: {
  cat: Category;
  list: DiscoverRow[];
  now: number;
  status: FeedStatus;
  sparks: Record<string, number[]>;
  win: Window;
  setWin: (w: Window) => void;
  launches: Map<string, FeedToken>;
  smart: Record<string, number>;
}) {
  const moves = useRankMoves(list.slice(0, 100).map((r) => r.mint));
  const podium = list.slice(0, 3);
  const rest = list.slice(3, 100);

  return (
    <div className="fade-up">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-2">{cat.windowed ? cat.description.replace(/last 5 minutes|1h price rise/, (m) => (m === "last 5 minutes" ? `last ${win}` : `${win} price rise`)) : cat.description}</p>
        {cat.windowed && (
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWin(w)}
                aria-pressed={win === w}
                className={`h-7 rounded-md px-3 font-mono text-xs transition-colors ${win === w ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
              >
                {w}
              </button>
            ))}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border px-8 py-20 text-center text-sm text-muted">
          {status === "live" ? "Nothing fits this category yet. It fills as data comes in" : "Connecting to the MONEXA gateway"}
        </div>
      ) : (
        <>
          {/* Podium: the top three get the spotlight */}
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {podium.map((r, i) => (
              <Spotlight key={r.mint} row={r} rank={i + 1} metric={cat.metric} now={now} move={moves.get(r.mint)} spark={sparks[r.mint]} win={win} safety={safetyScore(rowSignals(r, launches.get(r.mint) ?? null, smart[r.mint] ?? 0, now / 1000))} />
            ))}
          </div>

          {rest.length > 0 && (
            <>
              {/* Desktop: dense table */}
              <div className="mt-4 hidden overflow-hidden rounded-2xl border border-border bg-surface md:block">
                <TokenTable rows={rest} now={now} metric={cat.metric} startRank={4} moves={moves} sparks={sparks} launches={launches} smart={smart} />
              </div>
              {/* Mobile: compact rows */}
              <ol className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface md:hidden">
                {rest.map((r, i) => (
                  <MobileRow key={r.mint} row={r} rank={i + 4} metric={cat.metric} now={now} move={moves.get(r.mint)} spark={sparks[r.mint]} win={win} />
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Rank change per mint since the previous ordering: +2 means it climbed two places.
 *  Uses React's "adjust state while rendering" pattern, so no effect is needed. */
function useRankMoves(mints: string[]) {
  const sig = mints.join(",");
  const [s, setS] = useState(() => ({ sig, ranks: new Map(mints.map((m, i) => [m, i])), moves: new Map<string, number>() }));
  if (s.sig !== sig) {
    const ranks = new Map(mints.map((m, i) => [m, i]));
    const moves = new Map<string, number>();
    mints.forEach((m, i) => {
      const before = s.ranks.get(m);
      if (before !== undefined && before !== i) moves.set(m, before - i);
    });
    setS({ sig, ranks, moves });
  }
  return s.moves;
}

/** Live strip of the newest launches, newest first. */
function JustLaunched({ tokens, now }: { tokens: { mint: string; symbol: string; timestamp: number; meta: { image: string | null } | null; arrived?: boolean }[]; now: number }) {
  if (tokens.length === 0) return null;
  return (
    <div className="mt-6 flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-surface px-4 py-2.5">
      <span className="flex shrink-0 items-center gap-2 text-xs text-text-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
        Just launched
      </span>
      <div className="no-scrollbar flex min-w-0 gap-2 overflow-x-auto">
        {tokens.map((t) => (
          <Link
            key={t.mint}
            href={tokenHref(t.mint)}
            className={`flex shrink-0 items-center gap-2 rounded-lg border border-border bg-bg px-2 py-1 transition-colors hover:bg-surface-2 ${t.arrived ? "row-in" : ""}`}
          >
            <TokenLogo src={t.meta?.image ?? null} symbol={t.symbol} size={20} />
            <span className="max-w-24 truncate text-xs text-text">{t.symbol || "—"}</span>
            <span className={`font-mono text-[11px] ${now / 1000 - t.timestamp < 60 ? "text-emerald" : "text-muted"}`}>
              {formatAge(now / 1000 - t.timestamp)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CategoryTile({ cat, on, count, onClick }: { cat: Category; on: boolean; count: number; onClick: () => void }) {
  const Icon = ICONS[cat.key] ?? Flame;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-emerald ${
        on ? "border-emerald/40 bg-surface-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "border-border bg-surface hover:bg-surface-2"
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-emerald/15 text-emerald" : "bg-surface-2 text-muted"}`}>
        <Icon size={18} strokeWidth={1.5} />
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-medium ${on ? "text-text" : "text-text-2"}`}>{cat.label}</span>
        <span className="block font-mono text-xs text-muted">{count} tokens</span>
      </span>
    </button>
  );
}

/** Large card for ranks 1 to 3. */
function Spotlight({
  row: r,
  rank: n,
  metric,
  now,
  move,
  spark,
  win,
  safety,
}: {
  row: DiscoverRow;
  rank: number;
  metric: MetricKey;
  now: number;
  move?: number;
  spark?: number[];
  win: Window;
  safety: Safety;
}) {
  const f = figure(metric, r, win);
  const open = useOpenToken();
  const buys = r.buys1h ?? 0;
  const sells = r.sells1h ?? 0;
  const flow = buys + sells;
  return (
    <article
      onClick={open(r.mint)}
      className={`relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border bg-surface p-4 transition-colors duration-150 hover:bg-surface-2 ${
        n === 1 ? "border-emerald/30" : "border-border"
      }`}
    >
      {n === 1 && <span className="absolute inset-x-0 top-0 h-px bg-emerald/60" />}

      {/* Identity */}
      <div className="flex items-center gap-3">
        <TokenLogo src={r.image} symbol={r.symbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-base font-medium text-text">{r.symbol || "—"}</span>
              {r.verified && <BadgeCheck size={15} strokeWidth={1.5} className="shrink-0 text-cyan" aria-label="Verified" />}
              <SourceTag row={r} />
              <StarButton mint={r.mint} />
            </span>
            <span className="flex shrink-0 items-center gap-3 font-mono text-xs text-muted">
              <SafetyBadge safety={safety} />
              <span className="flex items-center gap-2">
                <Move by={move} />#{n}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 truncate text-text-2">{r.name}</span>
            <CopyMint mint={r.mint} />
          </div>
        </div>
      </div>

      {/* The ranking figure and price, with the chart beside them */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <Tick value={f.raw} className={`font-mono text-2xl ${f.tone}`}>
              {f.value}
            </Tick>
            <span className="text-xs text-muted">{f.unit}</span>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-2.5 font-mono text-[11px]">
            <span className="text-text">{price(r.priceUsd)}</span>
            <Change label="5m" v={r.change5m} />
            <Change label="1h" v={r.change1h} />
          </p>
        </div>
        <Sparkline points={spark} width={110} height={36} />
      </div>

      {/* Market figures in one row, buy and sell pressure under them */}
      <dl className="grid grid-cols-4 gap-2 border-t border-border pt-3 font-mono text-xs">
        <Mini k="MC" v={<Tick value={r.mcUsd}>{usd(r.mcUsd)}</Tick>} />
        <Mini k="Liquidity" v={usd(r.liquidityUsd)} />
        <Mini k="Holders" v={r.holders != null ? `${r.holdersApprox ? "~" : ""}${amount(r.holders)}` : "—"} />
        <Mini k="Age" v={age(r, now)} />
      </dl>
      <div className="flex items-center gap-2 font-mono text-[11px]" title={flow ? `Last hour: ${buys.toLocaleString()} buys, ${sells.toLocaleString()} sells` : "No trades counted"}>
        <span className="text-positive">{amount(buys)}</span>
        <span className="flex h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          {flow > 0 && (
            <>
              <span className="h-full bg-positive" style={{ width: `${(buys / flow) * 100}%` }} />
              <span className="h-full bg-negative" style={{ width: `${(sells / flow) * 100}%` }} />
            </>
          )}
        </span>
        <span className="text-negative">{amount(sells)}</span>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Socials twitter={r.twitter} telegram={r.telegram} website={r.website} />
        <AiButton input={() => inputFromRow(r)} />
        <div className="flex-1">
          <TradeLink mint={r.mint} full />
        </div>
      </div>
    </article>
  );
}

function Change({ label, v }: { label: string; v: number | null }) {
  return (
    <span>
      <span className="text-muted">{label} </span>
      <span className={changeTone(v)}>{pct(v)}</span>
    </span>
  );
}

function MobileRow({ row: r, rank: n, metric, now, move, spark, win }: { row: DiscoverRow; rank: number; metric: MetricKey; now: number; move?: number; spark?: number[]; win: Window }) {
  const f = figure(metric, r, win);
  const open = useOpenToken();
  return (
    <li onClick={open(r.mint)} className="flex cursor-pointer items-center gap-3 px-4 py-3">
      <span className="flex w-7 flex-col font-mono text-xs text-muted">
        {n}
        <Move by={move} />
      </span>
      <TokenLogo src={r.image} symbol={r.symbol} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-text">{r.symbol || "—"}</span>
          {r.verified && <BadgeCheck size={13} strokeWidth={1.5} className="shrink-0 text-cyan" aria-label="Verified" />}
          <SourceTag row={r} />
        </div>
        <div className="truncate font-mono text-xs text-muted">
          {age(r, now)} · {usd(r.mcUsd)}
        </div>
      </div>
      <Sparkline points={spark} width={48} height={20} />
      <div className="text-right">
        <Tick value={f.raw} className={`font-mono text-sm ${f.tone}`}>
          {f.value}
        </Tick>
        <div className="text-[11px] text-muted">{f.unit}</div>
      </div>
      <AiButton input={() => inputFromRow(r)} compact />
      <TradeLink mint={r.mint} />
    </li>
  );
}

function Mini({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="mt-0.5 truncate text-text">{v}</dd>
    </div>
  );
}

function Stat({ label, value, raw }: { label: string; value: string; raw?: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg text-text md:text-xl">{raw !== undefined ? <Tick value={raw}>{value}</Tick> : value}</dd>
    </div>
  );
}

function LiveBadge({ status, updatedAt, now }: { status: FeedStatus; updatedAt: number; now: number }) {
  const live = status === "live";
  const ago = updatedAt && now ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-text-2">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : "bg-warning"}`} />
      {live ? (ago == null ? "Live" : `Live · updated ${ago}s ago`) : status === "connecting" ? "Connecting" : "Reconnecting"}
    </span>
  );
}
