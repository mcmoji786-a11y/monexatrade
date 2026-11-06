"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { usd, type MarketToken } from "@/lib/gateway";
import { newLaunchFlags } from "@/lib/risk";
import { RadarScope } from "./radar-scope";
import { TokenCard } from "./token-card";
import { useNow, useRadarFeed, type FeedStatus, type RadarToken } from "./use-radar-feed";

type FilterCtx = { lowerRisk: Set<string> };
const FILTERS = {
  all: { label: "All", test: () => true },
  "lower-risk": { label: "Lower risk", test: (t: RadarToken, c: FilterCtx) => c.lowerRisk.has(t.mint) },
  socials: { label: "With socials", test: (t: RadarToken) => hasSocials(t) },
  traction: { label: "10+ holders", test: (t: RadarToken) => (t.market?.holders ?? 0) >= 10 },
  spread: {
    label: "Low concentration",
    test: (t: RadarToken) => !!t.market && t.market.top10_pct < 30 && t.market.dev_pct < 10,
  },
} as const satisfies Record<string, { label: string; test: (t: RadarToken, c: FilterCtx) => boolean }>;

const symbolKey = (t: RadarToken) => t.symbol.trim().toUpperCase();

/** Mints that pass every new-launch check (risk.ts). */
function lowerRiskSet(tokens: RadarToken[], markets: Record<string, MarketToken>, counts: Map<string, number>, nowSecs: number) {
  const out = new Set<string>();
  for (const t of tokens) {
    if (!newLaunchFlags(t, markets[t.mint] ?? null, (counts.get(symbolKey(t)) ?? 0) > 1, nowSecs).length) out.add(t.mint);
  }
  return out;
}
type FilterKey = keyof typeof FILTERS;

const SORTS = {
  newest: { label: "Newest", by: (t: RadarToken) => t.timestamp },
  volume: { label: "Volume 1h", by: (t: RadarToken) => t.market?.volume_1h_usd ?? -1 },
  mc: { label: "Market cap", by: (t: RadarToken) => t.market?.mc_usd ?? -1 },
  holders: { label: "Holders", by: (t: RadarToken) => t.market?.holders ?? -1 },
} as const;
type SortKey = keyof typeof SORTS;

/** Sol Radar: every new Solana token the moment it launches.
 *  Inactive tokens are dropped by the engine, so the grid only holds live coins. */
export function RadarBoard() {
  const { tokens, markets, solUsd, status } = useRadarFeed();
  const now = useNow();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const query = params.get("q") ?? "";
  const setQuery = (q: string) => {
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
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
  const lowerRisk = useMemo(() => lowerRiskSet(tokens, markets, symbolCounts, Math.floor(now / 1000)), [tokens, markets, symbolCounts, now]);
  const q = query.trim();
  const lower = q.toLowerCase();
  const visible = tokens
    .filter((t) => !q || t.mint === q || t.symbol.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower))
    .filter((t) => FILTERS[filter].test(t, { lowerRisk }))
    .sort((a, b) => SORTS[sort].by(b) - SORTS[sort].by(a));

  const lastMinute = now ? tokens.filter((t) => now / 1000 - t.timestamp <= 60).length : 0;
  const volume1h = tokens.reduce((s, t) => s + (t.market?.volume_1h_usd ?? 0), 0);
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
          <p className="mt-1 text-sm text-text-2">New Solana tokens as they launch, priced from on-chain trades</p>
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
              {k === "lower-risk" && <span className="ml-1.5 font-mono text-xs text-muted">{lowerRisk.size}</span>}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex h-8 w-64 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm focus-within:border-emerald/50">
            <Search size={14} strokeWidth={1.5} className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or address"
              aria-label="Filter by name or address"
              className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-muted"
              spellCheck={false}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="text-muted hover:text-text">
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

      {/* Grid */}
      {visible.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((t) => (
            <TokenCard
              key={t.mint}
              token={t}
              alt={markets[t.mint] ?? null}
              lowerRisk={lowerRisk.has(t.mint)}
              now={now}
              repeated={(symbolCounts.get(t.symbol.trim().toUpperCase()) ?? 0) > 1}
            />
          ))}
        </div>
      ) : (
        <EmptyState status={status} hasTokens={tokens.length > 0} query={q} looksLikeMint={looksLikeMint} lowerRisk={filter === "lower-risk"} />
      )}

      <p className="mt-6 max-w-3xl text-xs leading-5 text-muted">
        Prices, volume and holders are computed by MONEXA from on-chain trades. Holder counts are
        approximate. Logos and social links come from token creators and are not verified. A new
        token is not a recommendation, and most new tokens lose their value.
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
  let text = "Connecting to the MONEXA gateway";
  if (query && looksLikeMint) text = "This token is not on the radar right now. Looking up any Solana token by address comes next";
  else if (lowerRisk && hasTokens && !query)
    text = "No new coin passes every lower-risk check right now. Most launches fail on holders, social links or a copied symbol. Coins join here as soon as they pass";
  else if (query || hasTokens) text = "No token on the radar matches these filters";
  else if (status === "live") text = "Waiting for the next launch";
  else if (status === "reconnecting") text = "Live feed offline. Reconnecting";

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border px-8 py-20 text-center text-sm text-muted">
      {text}
    </div>
  );
}

function hasSocials(t: RadarToken) {
  return Boolean(t.meta && (t.meta.twitter || t.meta.telegram || t.meta.website));
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-xl ${accent ? "text-emerald" : "text-text"}`}>{value}</dd>
    </div>
  );
}

function LiveBadge({ status }: { status: FeedStatus }) {
  const live = status === "live";
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-text-2">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : "bg-warning"}`} />
      {live ? "Live" : status === "connecting" ? "Connecting" : "Reconnecting"}
    </span>
  );
}
