"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { usd, type MarketToken } from "@/lib/gateway";
import { dangerFound, lowerRiskNow, newLaunchChecks, type Check } from "@/lib/risk";
import { launchSignals, safetyScore } from "@/lib/safety";
import { useRadarFilters, useWatchlist } from "@/lib/prefs";
import { FiltersMenu, passesFilters } from "./filters-menu";
import { SniperMenu } from "@/components/sniper/sniper-menu";
import { PausableGrid } from "./pausable-grid";
import { AlertsMenu, useRadarAlerts } from "./alerts";
import { RadarScope } from "./radar-scope";
import { TokenCard } from "./token-card";
import {
  useNow,
  useRadarFeed,
  type FeedStatus,
  type RadarToken,
} from "./use-radar-feed";

type FilterCtx = { lowerRisk: Set<string>; watch: string[] };
const FILTERS = {
  all: { label: "All", test: () => true },
  "lower-risk": {
    label: "Lower risk",
    test: (t: RadarToken, c: FilterCtx) => c.lowerRisk.has(t.mint),
  },
  socials: { label: "With socials", test: (t: RadarToken) => hasSocials(t) },
  traction: {
    label: "10+ holders",
    test: (t: RadarToken) => (t.market?.holders ?? 0) >= 10,
  },
  spread: {
    label: "Low concentration",
    test: (t: RadarToken) =>
      !!t.market && t.market.top10_pct < 30 && t.market.dev_pct < 10,
  },
  watch: {
    label: "Watchlist",
    test: (t: RadarToken, c: FilterCtx) => c.watch.includes(t.mint),
  },
} as const satisfies Record<
  string,
  { label: string; test: (t: RadarToken, c: FilterCtx) => boolean }
>;

const symbolKey = (t: RadarToken) => t.symbol.trim().toUpperCase();

/** The X account a coin links to, as "handle" (lower case), or null. Links to a single
 *  post or a community count as that post or community, so reused posts show too. */
export function xKey(url: string | null | undefined) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)(x|twitter)\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    if (parts[0] === "i" && parts[1] === "communities") return `community/${parts[2] ?? ""}`;
    if (parts[1] === "status") return `post/${parts[2] ?? ""}`;
    return parts[0].toLowerCase();
  } catch {
    return null;
  }
}

/** Every new-launch check per coin (risk.ts). */
function checksFor(
  tokens: RadarToken[],
  markets: Record<string, MarketToken>,
  counts: Map<string, number>,
  firsts: Map<string, Original>,
  nowSecs: number,
) {
  const out = new Map<string, Check[]>();
  for (const t of tokens) {
    // A copy of another new coin, or of an established coin with the same symbol.
    const o = firsts.get(symbolKey(t));
    const copied =
      (counts.get(symbolKey(t)) ?? 0) > 1 || (!!o && o.mint !== t.mint);
    out.set(
      t.mint,
      newLaunchChecks(t, markets[t.mint] ?? null, copied, nowSecs),
    );
  }
  return out;
}

/** A coin we call the original of a symbol only on strong evidence: verified by the
 *  market provider, or long established (a day old, $50K+ liquidity, 1,000+ holders).
 *  The oldest new launch is never assumed original: copies often launch first, and
 *  the real coin is usually days old and not on the radar at all. */
const ESTABLISHED = {
  minAgeSecs: 86_400,
  minLiquidityUsd: 50_000,
  minHolders: 1_000,
};

export type Original = {
  mint: string;
  symbol: string;
  createdAt: number | null;
  verified: boolean;
};

function originals(markets: Record<string, MarketToken>) {
  const now = Date.now() / 1000;
  const out = new Map<string, { o: Original; liq: number }>();
  for (const t of Object.values(markets)) {
    const created = t.created_at ? Date.parse(t.created_at) / 1000 : NaN;
    const established =
      Number.isFinite(created) &&
      now - created >= ESTABLISHED.minAgeSecs &&
      (t.liquidity_usd ?? 0) >= ESTABLISHED.minLiquidityUsd &&
      (t.holders ?? 0) >= ESTABLISHED.minHolders;
    if (!t.verified && !established) continue;
    const k = t.symbol.trim().toUpperCase();
    const liq = (t.verified ? 1e15 : 0) + (t.liquidity_usd ?? 0);
    const cur = out.get(k);
    // Several qualify: verified first, then the deepest liquidity.
    if (!cur || liq > cur.liq) {
      out.set(k, {
        o: {
          mint: t.mint,
          symbol: t.symbol,
          createdAt: Number.isFinite(created) ? created : null,
          verified: t.verified,
        },
        liq,
      });
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.o]));
}
type FilterKey = keyof typeof FILTERS;

const SORTS = {
  newest: { label: "Newest", by: (t: RadarToken) => t.timestamp },
  volume: {
    label: "Volume 1h",
    by: (t: RadarToken) => t.market?.volume_1h_usd ?? -1,
  },
  mc: { label: "Market cap", by: (t: RadarToken) => t.market?.mc_usd ?? -1 },
  holders: { label: "Holders", by: (t: RadarToken) => t.market?.holders ?? -1 },
} as const;
type SortKey = keyof typeof SORTS;


/** Sol Radar: every new Solana token the moment it launches.
 *  Inactive tokens are dropped by the engine, so the grid only holds live coins. */
export function RadarBoard() {
  // Live data renders at low priority: clicks and navigation always come first.
  const feed = useDeferredValue(useRadarFeed());
  const { tokens, markets, solUsd, smart, status } = feed;
  const watch = useWatchlist().mints;
  const now = useDeferredValue(useNow());
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const { filters: adv } = useRadarFilters();

  const query = params.get("q") ?? "";
  const setQuery = (q: string) => {
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    router.replace(next.size ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  };

  const symbolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tokens) {
      const k = t.symbol.trim().toUpperCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [tokens]);

  // Re-checked every second (useNow) so a coin joins once it is old enough.
  const firsts = useMemo(() => originals(markets), [markets]);
  // How many coins on the radar link the same X account or post.
  const xCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tokens) {
      const k = xKey(t.meta?.twitter);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [tokens]);
  const checks = useMemo(
    () =>
      checksFor(tokens, markets, symbolCounts, firsts, Math.floor(now / 1000)),
    [tokens, markets, symbolCounts, firsts, now],
  );
  // What each card is given (and so what its safety ring is computed from).
  const ctxOf = (t: RadarToken) => {
    const o = firsts.get(symbolKey(t));
    const original = o && o.mint !== t.mint ? o : null;
    const k = xKey(t.meta?.twitter);
    const others = k ? (xCounts.get(k) ?? 1) - 1 : 0;
    const xShare = k && others > 0 ? { others, kind: k.startsWith("post/") || k.startsWith("community/") ? ("post" as const) : ("account" as const) } : null;
    const repeated = (symbolCounts.get(symbolKey(t)) ?? 0) > 1;
    return { original, xShare, repeated };
  };
  // Lower risk = the card's safety score is 80+ with no danger check (risk.ts). Joins
  // at once, stays at least 3 minutes, leaves early only on a danger check.
  const lowerRisk = useMemo(() => {
    const all = new Map<string, { score: number; danger: boolean }>();
    for (const t of tokens) {
      const { original, xShare, repeated } = ctxOf(t);
      const score = safetyScore(
        launchSignals(t, markets[t.mint] ?? null, {
          copyOfReal: !!original,
          sameSymbol: repeated && !original,
          sameXAccount: xShare?.kind === "account",
          smart: smart[t.mint] ?? 0,
          nowSecs: now / 1000,
        }),
      ).score;
      all.set(t.mint, { score, danger: dangerFound(checks.get(t.mint) ?? []) });
    }
    return lowerRiskNow(all, Math.floor(now / 1000));
    // ctxOf reads firsts, xCounts and symbolCounts, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, markets, smart, checks, firsts, xCounts, symbolCounts, now]);
  useRadarAlerts(tokens, lowerRisk);
  const q = query.trim();
  const lower = q.toLowerCase();
  const visible = tokens
    .filter(
      (t) =>
        !q ||
        t.mint === q ||
        t.symbol.toLowerCase().includes(lower) ||
        t.name.toLowerCase().includes(lower),
    )
    .filter((t) => FILTERS[filter].test(t, { lowerRisk, watch }))
    .filter((t) =>
      passesFilters(t, markets[t.mint] ?? null, adv, Math.floor(now / 1000)),
    )
    .sort((a, b) => SORTS[sort].by(b) - SORTS[sort].by(a));

  const card = (t: RadarToken) => (
    <TokenCard
      key={t.mint}
      token={t}
      alt={markets[t.mint] ?? null}
      smart={smart[t.mint] ?? 0}
      checks={checks.get(t.mint) ?? []}
      lowerRisk={lowerRisk.has(t.mint)}
      original={ctxOf(t).original}
      sameSymbol={(symbolCounts.get(symbolKey(t)) ?? 1) - 1}
      xShare={ctxOf(t).xShare}
      now={now}
      repeated={ctxOf(t).repeated}
    />
  );

  const lastMinute = now
    ? tokens.filter((t) => now / 1000 - t.timestamp <= 60).length
    : 0;
  const volume1h = tokens.reduce(
    (s, t) => s + (t.market?.volume_1h_usd ?? 0),
    0,
  );
  const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);

  return (
    <section>
      {/* Header strip: title, live state, key numbers and the radar */}
      <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text">Sol Radar</h1>
            <LiveBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-text-2">
            New Solana tokens as they launch, priced from on-chain trades
          </p>
        </div>

        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Stat label="Launches, last min" value={String(lastMinute)} accent />
          <Stat label="On the radar" value={String(tokens.length)} />
          <Stat label="Volume, last hour" value={usd(volume1h)} />
          <Stat label="SOL" value={solUsd ? `$${solUsd.toFixed(2)}` : "—"} />
        </dl>

        <div className="hidden lg:block">
          <RadarScope tokens={tokens} now={now} size={104} />
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-y border-border py-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter">
          {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`h-8 rounded-lg px-3 text-sm transition-colors duration-150 ${
                filter === k
                  ? "bg-surface-3 text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-text-2 hover:bg-surface-2 hover:text-text"
              }`}
            >
              {FILTERS[k].label}
              {k === "lower-risk" && (
                <span className="ml-1.5 font-mono text-xs text-muted">
                  {lowerRisk.size}
                </span>
              )}
              {k === "watch" && watch.length > 0 && (
                <span className="ml-1.5 font-mono text-xs text-muted">
                  {tokens.filter((t) => watch.includes(t.mint)).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <SniperMenu />
          <FiltersMenu />
          <AlertsMenu />
          <label className="flex h-8 w-64 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm focus-within:border-emerald/50">
            <Search
              size={14}
              strokeWidth={1.5}
              className="shrink-0 text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or address"
              aria-label="Filter by name or address"
              className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-muted"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear"
                className="text-muted hover:text-text"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            )}
          </label>
          <label className="flex h-8 items-center gap-2 text-sm text-muted">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-text outline-none focus:border-emerald/50"
            >
              {(Object.keys(SORTS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORTS[k].label}
                </option>
              ))}
            </select>
          </label>
          <span className="font-mono text-xs text-muted">
            {visible.length}/{tokens.length}
          </span>
        </div>
      </div>

      {/* Grid: pauses while the pointer is over it */}
      {visible.length > 0 ? (
        <PausableGrid tokens={visible} render={card} />
      ) : (
        <EmptyState
          status={status}
          hasTokens={tokens.length > 0}
          query={q}
          looksLikeMint={looksLikeMint}
          lowerRisk={filter === "lower-risk"}
        />
      )}

      <p className="mt-6 max-w-3xl text-xs leading-5 text-muted">
        Prices, volume and holders are computed by Kixo from on-chain trades.
        Holder counts are approximate. Logos and social links come from token
        creators and are not verified. A new token is not a recommendation, and
        most new tokens lose their value.
      </p>
    </section>
  );
}

function EmptyState({
  status,
  hasTokens,
  query,
  looksLikeMint,
  lowerRisk,
}: {
  status: FeedStatus;
  hasTokens: boolean;
  query: string;
  looksLikeMint: boolean;
  lowerRisk: boolean;
}) {
  let text = "Connecting to the Kixo gateway";
  if (query && looksLikeMint)
    text =
      "This token is not on the radar right now. Looking up any Solana token by address comes next";
  else if (lowerRisk && hasTokens && !query)
    text =
      "No new coin has a safety score of 80 or more right now. A coin joins the moment it reaches 80 and stays at least 3 minutes";
  else if (query || hasTokens)
    text = "No token on the radar matches these filters";
  else if (status === "live") text = "Waiting for the next launch";
  else if (status === "reconnecting") text = "Live feed offline. Reconnecting";

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border px-8 py-20 text-center text-sm text-muted">
      {text}
    </div>
  );
}

function hasSocials(t: RadarToken) {
  return Boolean(
    t.meta && (t.meta.twitter || t.meta.telegram || t.meta.website),
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={`mt-1 font-mono text-xl ${accent ? "text-emerald" : "text-text"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function LiveBadge({ status }: { status: FeedStatus }) {
  const live = status === "live";
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-text-2">
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : "bg-warning"}`}
      />
      {live ? "Live" : status === "connecting" ? "Connecting" : "Reconnecting"}
    </span>
  );
}
