"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { usd } from "@/lib/gateway";
import { RadarScope } from "./radar-scope";
import { TokenCard } from "./token-card";
import { useNow, useRadarFeed, type FeedStatus, type RadarToken } from "./use-radar-feed";

/** Sol Radar: every new Solana token the moment it launches, newest first.
 *  Inactive tokens are dropped by the engine, so the grid only holds live coins. */
export function RadarBoard() {
  const { tokens, solUsd, status } = useRadarFeed();
  const now = useNow();
  const [query, setQuery] = useState("");

  const symbolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tokens) {
      const k = t.symbol.trim().toUpperCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [tokens]);

  const q = query.trim();
  const lower = q.toLowerCase();
  const visible = q
    ? tokens.filter((t) => t.mint === q || t.symbol.toLowerCase().includes(lower) || t.name.toLowerCase().includes(lower))
    : tokens;
  const sorted = [...visible].sort((a, b) => b.timestamp - a.timestamp);

  const lastMinute = now ? tokens.filter((t) => now / 1000 - t.timestamp <= 60).length : 0;
  const volume1h = tokens.reduce((s, t) => s + (t.market?.volume_1h_usd ?? 0), 0);
  const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);

  return (
    <section className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-8">
        <div className="max-w-xl">
          <div className="flex items-center gap-2 font-mono text-xs text-muted">
            <StatusDot status={status} />
            {status === "live" ? "Live from Solana mainnet" : status === "connecting" ? "Connecting" : "Reconnecting"}
            {solUsd && <span className="pl-2">SOL ${solUsd.toFixed(2)}</span>}
          </div>
          <h1 className="mt-3 text-3xl font-medium">Sol Radar</h1>
          <p className="mt-2 text-sm leading-5 text-text-2">
            New Solana tokens the moment they launch. Inactive tokens leave the radar on their own
          </p>
          <label className="mt-4 flex h-9 max-w-md items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm focus-within:border-emerald/50">
            <Search size={16} strokeWidth={1.5} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, ticker or contract address"
              className="w-full bg-transparent text-text outline-none placeholder:text-muted"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="flex items-center gap-8">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
            <Stat label="Launches, last minute" value={String(lastMinute)} accent />
            <Stat label="On the radar" value={String(tokens.length)} />
            <Stat label="Volume, last hour" value={usd(volume1h)} />
            <Stat label="With social links" value={String(tokens.filter(hasSocials).length)} />
          </dl>
          <RadarScope tokens={tokens} now={now} />
        </div>
      </header>

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex h-11 items-center justify-between border-b border-border px-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            {status === "live" && <span className="h-1.5 w-1.5 rounded-full bg-emerald" />}
            New launches
          </h2>
          <span className="font-mono text-xs text-muted">
            {q ? `${sorted.length} of ${tokens.length}` : tokens.length}
          </span>
        </div>

        {sorted.length > 0 ? (
          <div className="grid gap-px bg-border md:grid-cols-2 2xl:grid-cols-3">
            {sorted.map((t) => (
              <div key={t.mint} className="bg-surface">
                <TokenCard
                  token={t}
                  now={now}
                  repeated={(symbolCounts.get(t.symbol.trim().toUpperCase()) ?? 0) > 1}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-8 py-20 text-center text-sm leading-5 text-muted">
            {q
              ? looksLikeMint
                ? "This token is not on the radar right now. Looking up any Solana token by address is the next stage"
                : "No token on the radar matches this search"
              : status === "live"
                ? "Waiting for the next launch"
                : "Connecting to the MONEXA gateway"}
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Prices, volume and holders are computed by MONEXA from on-chain trades. Holder counts are
        approximate. Logos and social links come from token creators and are not verified. A new
        token is not a recommendation, and most new tokens lose their value.
      </p>
    </section>
  );
}

function hasSocials(t: RadarToken) {
  return Boolean(t.meta && (t.meta.twitter || t.meta.telegram || t.meta.website));
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-2xl ${accent ? "text-emerald" : "text-text"}`}>{value}</dd>
    </div>
  );
}

function StatusDot({ status }: { status: FeedStatus }) {
  return <span className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald" : "bg-warning"}`} />;
}
