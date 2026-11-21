"use client";
import { TradeLink } from "@/components/token/trade-link";
import { QuickBuy } from "@/components/trade/quick-buy";

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
import { amount, pct, usd } from "@/lib/gateway";
import { formatAge, useNow, useRadarFeed, type FeedStatus } from "@/components/radar/use-radar-feed";
import { TokenLogo } from "@/components/token/token-bits";
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
  const [view, setView] = useState<"table" | "cards">(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("mx.discover.view") === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  });
  const pickView = (v: "table" | "cards") => {
    setView(v);
    try {
      localStorage.setItem("mx.discover.view", v);
    } catch {}
  };
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
      {/* One line: the title, the categories and the controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-1.5">
        <div className="flex shrink-0 items-center gap-2 pr-2" title="Solana memecoins moving right now, updated live">
          <h1 className="text-lg font-medium text-text">Discover</h1>
          <LiveBadge status={status} updatedAt={updatedAt} now={now} />
        </div>
        <div className="no-scrollbar flex min-w-0 gap-0.5 overflow-x-auto" role="tablist" aria-label="Categories">
          {cats.map((c) => (
            <CategoryTile key={c.key} cat={c} on={c.key === cat.key} count={ranked[c.key].length} onClick={() => setActive(c.key)} />
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {cat.windowed && (
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Time window">
              {WINDOWS.map((w) => (
                <button key={w} type="button" onClick={() => setWin(w)} aria-pressed={win === w} className={`h-6 rounded px-2 font-mono text-[11px] transition-colors ${win === w ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}>
                  {w}
                </button>
              ))}
            </div>
          )}
          <span className="[&_button]:h-7 [&_button]:text-xs">
            <DiscoverFiltersMenu />
          </span>
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="View">
            {(["table", "cards"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => pickView(v)} className={`h-6 rounded px-2 text-[11px] capitalize transition-colors ${view === v ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The newest launches, with the market figures beside them */}
      <div className="mt-1.5 flex items-center gap-4">
        <JustLaunched tokens={latest} now={now} />
        <dl className="hidden shrink-0 items-center gap-x-4 xl:flex">
          <Stat label="Tokens" value={String(rows.length)} />
          <Stat label="Vol 1h" value={usd(volume1h)} raw={volume1h} />
          <Stat label="SOL" value={solUsd ? `$${solUsd.toFixed(2)}` : "—"} raw={solUsd} />
        </dl>
      </div>

      <CategoryView key={cat.key} cat={cat} list={ranked[cat.key]} now={now} status={status} sparks={sparks} win={win} launches={launches} smart={smart} view={view} />

      <p className="mt-6 max-w-3xl text-xs leading-5 text-muted">
        Memecoins only: tokens tagged meme or launched on a memecoin launchpad. Stocks, RWAs and DeFi tokens are
        excluded. Prices for new launches are computed by Kixo from every trade. Holders, liquidity and
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
  launches,
  smart,
  view,
}: {
  view: "table" | "cards";
  cat: Category;
  list: DiscoverRow[];
  now: number;
  status: FeedStatus;
  sparks: Record<string, number[]>;
  win: Window;
  launches: Map<string, FeedToken>;
  smart: Record<string, number>;
}) {
  const moves = useRankMoves(list.slice(0, 100).map((r) => r.mint));
  // Table view: every coin in one dense table. Cards view: every coin as a compact card,
  // the same build as Sol Radar's.
  const rest = list.slice(0, 100);

  return (
    <div className="fade-up">

      {list.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-border px-8 py-16 text-center text-sm text-muted">
          {status === "live" ? "Nothing fits this category yet. It fills as data comes in" : "Connecting to the Kixo gateway"}
        </div>
      ) : (
        <>
          {view === "cards" && (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3 min-[2200px]:grid-cols-4">
              {rest.map((r, i) => (
                <CoinCard key={r.mint} row={r} rank={i + 1} metric={cat.metric} now={now} move={moves.get(r.mint)} spark={sparks[r.mint]} win={win} safety={safetyScore(rowSignals(r, launches.get(r.mint) ?? null, smart[r.mint] ?? 0, now / 1000))} />
              ))}
            </div>
          )}

          {view === "table" && rest.length > 0 && (
            <>
              {/* Desktop: dense table */}
              <div className="mt-3 hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
                <TokenTable rows={rest} now={now} metric={cat.metric} startRank={1} moves={moves} sparks={sparks} launches={launches} smart={smart} />
              </div>
              {/* Mobile: compact rows */}
              <ol className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface md:hidden">
                {rest.map((r, i) => (
                  <MobileRow key={r.mint} row={r} rank={i + 1} metric={cat.metric} now={now} move={moves.get(r.mint)} spark={sparks[r.mint]} win={win} />
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
    <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-lg border border-border bg-surface px-3 py-1.5">
      <span className="flex shrink-0 items-center gap-2 text-xs text-text-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
        Just launched
      </span>
      <div className="no-scrollbar flex min-w-0 gap-2 overflow-x-auto">
        {tokens.map((t) => (
          <Link
            key={t.mint}
            href={tokenHref(t.mint)}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-bg px-1.5 transition-colors hover:bg-surface-2 ${t.arrived ? "row-in" : ""}`}
          >
            <TokenLogo src={t.meta?.image ?? null} symbol={t.symbol} size={18} />
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
      title={cat.description}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${
        on ? "bg-surface-3 text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"
      }`}
    >
      <Icon size={13} strokeWidth={1.5} className={on ? "text-emerald" : "text-muted"} />
      {cat.label}
      <span className="font-mono text-[11px] text-muted">{count}</span>
    </button>
  );
}

/** One coin as a compact card, built like Sol Radar's: identity and market cap, age,
 *  links, holders and the 5 minute move, the figure this category ranks by with its
 *  chart, then buy/sell pressure, liquidity, top 10, safety and actions. */
function CoinCard({
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
  const top10 = r.top10Pct;
  return (
    <article
      onClick={open(r.mint)}
      className={`group flex cursor-pointer flex-col rounded-lg border bg-surface transition-colors duration-150 hover:bg-surface-2 ${n === 1 ? "border-emerald/40" : "border-border hover:border-[rgb(255_255_255/0.16)]"}`}
    >
      <div className="flex gap-2.5 p-2.5 pb-2">
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <TokenLogo src={r.image} symbol={r.symbol} size={56} />
          <span className="flex items-center gap-1 font-mono text-[10px] leading-3 text-muted">
            #{n}
            <Move by={move} />
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="max-w-[45%] shrink-0 truncate text-[13px] font-medium text-text" title={r.symbol}>
              {r.symbol || "—"}
            </span>
            {r.verified && <BadgeCheck size={13} strokeWidth={1.5} className="shrink-0 text-cyan" aria-label="Verified" />}
            <span className="min-w-0 truncate text-[11px] text-muted" title={r.name}>
              {r.name}
            </span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              <StarButton mint={r.mint} size={11} />
            </span>
            <span className="ml-auto shrink-0 font-mono text-sm leading-5 text-cyan" title="Market cap">
              <span className="font-sans text-[10px] text-muted">MC </span>
              <Tick value={r.mcUsd}>{usd(r.mcUsd)}</Tick>
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-2 text-[11px]">
            <span className="font-mono text-text-2" title="Age">
              {age(r, now)}
            </span>
            <span className="[&_a]:h-4 [&_a]:w-4">
              <Socials twitter={r.twitter} telegram={r.telegram} website={r.website} />
            </span>
            <span className="font-mono text-text-2" title="Holders">
              {r.holders != null ? `${r.holdersApprox ? "~" : ""}${amount(r.holders)}` : "—"}
              <span className="ml-0.5 font-sans text-[10px] text-muted">holders</span>
            </span>
            <span className="ml-auto shrink-0 font-mono">
              <span className={changeTone(r.change5m)}>{pct(r.change5m)}</span>
              <span className="ml-0.5 font-sans text-[10px] text-muted">5m</span>
              <span className={`ml-2 ${changeTone(r.change1h)}`}>{pct(r.change1h)}</span>
              <span className="ml-0.5 font-sans text-[10px] text-muted">1h</span>
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <Tick value={f.raw} className={`shrink-0 font-mono text-[13px] ${f.tone}`}>
              {f.value}
            </Tick>
            <span className="min-w-0 truncate text-[10px] text-muted">{f.unit}</span>
            <span className="ml-auto shrink-0">
              <Sparkline points={spark} width={84} height={20} />
            </span>
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2.5 border-t border-border px-2.5 py-1.5 font-mono text-[11px]">
        <span className="flex items-center gap-1" title={flow ? `Last hour: ${buys.toLocaleString()} buys, ${sells.toLocaleString()} sells` : "No trades counted"}>
          <span className="text-positive">{amount(buys)}</span>
          <span className="flex h-0.5 w-8 overflow-hidden rounded-full bg-surface-3">
            {flow > 0 && (
              <>
                <span className="h-full bg-positive" style={{ width: `${(buys / flow) * 100}%` }} />
                <span className="h-full bg-negative" style={{ width: `${(sells / flow) * 100}%` }} />
              </>
            )}
          </span>
          <span className="text-negative">{amount(sells)}</span>
        </span>
        <span title="Liquidity">
          <span className="font-sans text-[10px] text-muted">Liq </span>
          <span className="text-text-2">{usd(r.liquidityUsd)}</span>
        </span>
        {top10 != null && (
          <span title="Top 10 holders' share" className={top10 >= 30 ? "text-negative" : "text-positive"}>
            <span className="font-sans text-[10px] text-muted">T10 </span>
            {top10.toFixed(0)}%
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 [&_button]:h-6">
          <SafetyBadge safety={safety} align="right" />
          <AiButton input={() => inputFromRow(r)} safety={safety} compact />
          <QuickBuy mint={r.mint} symbol={r.symbol} className="px-2" />
        </span>
      </div>
    </article>
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

function Stat({ label, value, raw }: { label: string; value: string; raw?: number | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="font-mono text-[13px] text-text">{raw !== undefined ? <Tick value={raw}>{value}</Tick> : value}</dd>
    </div>
  );
}

function LiveBadge({ status, updatedAt, now }: { status: FeedStatus; updatedAt: number; now: number }) {
  const live = status === "live";
  const ago = updatedAt && now ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <span title={ago == null ? undefined : `Updated ${ago}s ago`} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-text-2">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : "bg-warning"}`} />
      {live ? "Live" : status === "connecting" ? "Connecting" : "Reconnecting"}
    </span>
  );
}
