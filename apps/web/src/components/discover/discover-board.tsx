"use client";
import { TradeLink } from "@/components/token/trade-link";

import Link from "next/link";
import { tokenHref, useOpenToken } from "@/lib/open-token";
import { Socials } from "@/components/token/socials";
import { AiButton } from "@/components/token/ai-analysis";
import { Sparkline } from "@/components/token/sparkline";
import { inputFromRow } from "@/lib/ai";

import { useMemo, useState } from "react";
import { Activity, BadgeCheck, Crosshair, Flame, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { buildRows, CATEGORIES, rank, rowRisk, type Category, type DiscoverRow, type MetricKey } from "@/lib/categories";
import { pct, usd } from "@/lib/gateway";
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
};

/** The figure a category ranks by: raw value (for the flash), text, colour and unit. */
function figure(metric: MetricKey, r: DiscoverRow) {
  switch (metric) {
    case "volume5m":
      return { raw: r.vol5mUsd, value: usd(r.vol5mUsd), tone: "text-text", unit: "traded in 5m" };
    case "change1h":
      return { raw: r.change1h, value: pct(r.change1h), tone: changeTone(r.change1h), unit: "in 1h" };
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
  const { tokens, markets, solUsd, sparks, status, updatedAt } = useRadarFeed();
  const now = useNow();
  const [active, setActive] = useState(CATEGORIES[0].key);

  const rows = useMemo(() => buildRows(tokens, markets, solUsd), [tokens, markets, solUsd]);
  const ranked = useMemo(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.key, rank(rows, c)])) as Record<string, DiscoverRow[]>,
    [rows],
  );
  const cat = CATEGORIES.find((c) => c.key === active) ?? CATEGORIES[0];
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
      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5" role="tablist" aria-label="Categories">
        {CATEGORIES.map((c) => (
          <CategoryTile key={c.key} cat={c} on={c.key === cat.key} count={ranked[c.key].length} onClick={() => setActive(c.key)} />
        ))}
      </div>

      <JustLaunched tokens={latest} now={now} />

      <CategoryView key={cat.key} cat={cat} list={ranked[cat.key]} now={now} status={status} sparks={sparks} />

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
}: {
  cat: Category;
  list: DiscoverRow[];
  now: number;
  status: FeedStatus;
  sparks: Record<string, number[]>;
}) {
  const moves = useRankMoves(list.slice(0, 100).map((r) => r.mint));
  const podium = list.slice(0, 3);
  const rest = list.slice(3, 100);

  return (
    <div className="fade-up">
      <p className="mt-6 text-sm text-text-2">{cat.description}</p>

      {list.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border px-8 py-20 text-center text-sm text-muted">
          {status === "live" ? "Nothing fits this category yet. It fills as data comes in" : "Connecting to the MONEXA gateway"}
        </div>
      ) : (
        <>
          {/* Podium: the top three get the spotlight */}
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {podium.map((r, i) => (
              <Spotlight key={r.mint} row={r} rank={i + 1} metric={cat.metric} now={now} move={moves.get(r.mint)} spark={sparks[r.mint]} />
            ))}
          </div>

          {rest.length > 0 && (
            <>
              {/* Desktop: dense table */}
              <div className="mt-4 hidden overflow-hidden rounded-2xl border border-border bg-surface md:block">
                <TokenTable rows={rest} now={now} metric={cat.metric} startRank={4} moves={moves} sparks={sparks} />
              </div>
              {/* Mobile: compact rows */}
              <ol className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface md:hidden">
                {rest.map((r, i) => (
                  <MobileRow key={r.mint} row={r} rank={i + 4} metric={cat.metric} now={now} move={moves.get(r.mint)} spark={sparks[r.mint]} />
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
function Spotlight({ row: r, rank: n, metric, now, move, spark }: { row: DiscoverRow; rank: number; metric: MetricKey; now: number; move?: number; spark?: number[] }) {
  const f = figure(metric, r);
  const open = useOpenToken();
  return (
    <article
      onClick={open(r.mint)}
      className={`relative cursor-pointer overflow-hidden rounded-2xl border bg-surface p-5 transition-colors duration-150 hover:bg-surface-2 ${
        n === 1 ? "border-emerald/30" : "border-border"
      }`}
    >
      {n === 1 && <span className="absolute inset-x-0 top-0 h-px bg-emerald/60" />}
      <div className="flex items-start gap-4">
        <TokenLogo src={r.image} symbol={r.symbol} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-base font-medium text-text">{r.symbol || "—"}</span>
              {r.verified && <BadgeCheck size={15} strokeWidth={1.5} className="shrink-0 text-cyan" aria-label="Verified" />}
              <SourceTag row={r} />
            </span>
            <span className="flex items-center gap-2 font-mono text-xs text-muted">
              <Move by={move} />#{n}
            </span>
          </div>
          <div className="truncate text-sm text-text-2">{r.name}</div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <CopyMint mint={r.mint} />
            <Socials twitter={r.twitter} telegram={r.telegram} website={r.website} />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <Tick value={f.raw} className={`font-mono text-3xl ${f.tone}`}>
            {f.value}
          </Tick>
          <span className="text-xs text-muted">{f.unit}</span>
        </div>
        <Sparkline points={spark} width={96} height={32} />
      </div>

      <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-border pt-4 font-mono text-xs">
        <Mini k="MC" v={<Tick value={r.mcUsd}>{usd(r.mcUsd)}</Tick>} />
        <Mini k="Vol 1h" v={usd(r.vol1hUsd)} />
        <Mini k="Holders" v={r.holders != null ? `${r.holdersApprox ? "~" : ""}${r.holders.toLocaleString()}` : "—"} />
        <Mini k="Age" v={age(r, now)} />
      </dl>
      <div className="mt-4 flex gap-2">
        <AiButton input={() => inputFromRow(r)} />
        <div className="flex-1">
          <TradeLink mint={r.mint} full />
        </div>
      </div>
    </article>
  );
}

function MobileRow({ row: r, rank: n, metric, now, move, spark }: { row: DiscoverRow; rank: number; metric: MetricKey; now: number; move?: number; spark?: number[] }) {
  const f = figure(metric, r);
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
