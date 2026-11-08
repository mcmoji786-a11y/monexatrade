"use client";
import { TradeLink } from "@/components/token/trade-link";
import { QuickBuy } from "@/components/trade/quick-buy";
import { useOpenToken } from "@/lib/open-token";
import { Socials } from "@/components/token/socials";
import { AiButton } from "@/components/token/ai-analysis";
import { Sparkline } from "@/components/token/sparkline";
import { SafetyBadge } from "@/components/token/safety-badge";
import { rowSignals, safetyScore } from "@/lib/safety";
import type { FeedToken } from "@/lib/gateway";
import { StarButton } from "@/components/token/star-button";
import { inputFromRow } from "@/lib/ai";

import { useState } from "react";
import { ArrowDown, ArrowUp, BadgeCheck } from "lucide-react";
import type { DiscoverRow, MetricKey } from "@/lib/categories";
import { amount, pct, price, usd } from "@/lib/gateway";
import { formatAge } from "@/components/radar/use-radar-feed";
import { CopyMint, TokenLogo } from "@/components/token/token-bits";
import { Tick } from "@/components/token/tick";

const TOP10_WARN = 30;

type Col = {
  key: string;
  /** The category metric this column shows, if any (it gets highlighted). */
  metric?: MetricKey;
  label: string;
  title?: string;
  cell: (r: DiscoverRow, now: number) => React.ReactNode;
  /** Number the column sorts by (null sorts last). */
  value: (r: DiscoverRow) => number | null;
  /** Shown only on wide screens, so the table never runs under the action column. */
  wide?: boolean;
};

const WIDE = "hidden min-[1800px]:table-cell";

export const changeTone = (v: number | null | undefined) =>
  v == null ? "text-muted" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-text-2";

export const age = (r: DiscoverRow, now: number) => (r.createdAt && now ? formatAge(now / 1000 - r.createdAt) : "—");

const COLUMNS: Col[] = [
  { key: "price", label: "Price", value: (r) => r.priceUsd, cell: (r) => <Tick value={r.priceUsd}>{price(r.priceUsd)}</Tick> },
  {
    key: "c5",
    label: "5m",
    value: (r) => r.change5m,
    cell: (r) => (
      <Tick value={r.change5m} className={changeTone(r.change5m)}>
        {pct(r.change5m)}
      </Tick>
    ),
  },
  {
    key: "c1h",
    metric: "change1h",
    label: "1h",
    value: (r) => r.change1h,
    cell: (r) => (
      <Tick value={r.change1h} className={changeTone(r.change1h)}>
        {pct(r.change1h)}
      </Tick>
    ),
  },
  {
    key: "c24",
    label: "24h",
    wide: true,
    value: (r) => r.change24h,
    cell: (r) => <span className={changeTone(r.change24h)}>{pct(r.change24h)}</span>,
  },
  { key: "mc", label: "MC", value: (r) => r.mcUsd, cell: (r) => <Tick value={r.mcUsd}>{usd(r.mcUsd)}</Tick> },
  { key: "liq", label: "Liquidity", value: (r) => r.liquidityUsd, cell: (r) => usd(r.liquidityUsd) },
  { key: "v5", metric: "volume5m", label: "Vol 5m", value: (r) => r.vol5mUsd, cell: (r) => <Tick value={r.vol5mUsd}>{usd(r.vol5mUsd)}</Tick> },
  { key: "v1h", label: "Vol 1h", wide: true, value: (r) => r.vol1hUsd, cell: (r) => <Tick value={r.vol1hUsd}>{usd(r.vol1hUsd)}</Tick> },
  { key: "v24", label: "Vol 24h", wide: true, value: (r) => r.vol24hUsd, cell: (r) => usd(r.vol24hUsd) },
  {
    key: "trades",
    metric: "trades",
    label: "Buys/Sells 1h",
    value: (r) => (r.buys1h == null ? null : r.buys1h + (r.sells1h ?? 0)),
    cell: (r) => {
      if (r.buys1h == null) return "—";
      const b = r.buys1h;
      const s = r.sells1h ?? 0;
      const total = b + s;
      return (
        <span className="inline-flex flex-col items-end gap-1" title={`${b.toLocaleString()} buys, ${s.toLocaleString()} sells in the last hour`}>
          <span>
            <span className="text-positive">{amount(b)}</span>
            <span className="text-muted"> / </span>
            <span className="text-negative">{amount(s)}</span>
          </span>
          <span className="flex h-1 w-16 overflow-hidden rounded-full bg-surface-3">
            {total > 0 && (
              <>
                <span className="h-full bg-positive" style={{ width: `${(b / total) * 100}%` }} />
                <span className="h-full bg-negative" style={{ width: `${(s / total) * 100}%` }} />
              </>
            )}
          </span>
        </span>
      );
    },
  },
  {
    key: "holders",
    label: "Holders",
    value: (r) => r.holders,
    cell: (r) => (r.holders != null ? <Tick value={r.holders}>{`${r.holdersApprox ? "~" : ""}${r.holders.toLocaleString()}`}</Tick> : "—"),
  },
  {
    key: "snipers",
    metric: "snipers",
    label: "Early buyers",
    value: (r) => r.sniperPct,
    title: "New launches: wallets that bought within 3 s · share they still hold",
    cell: (r) => (r.snipers != null ? `${r.snipers} · ${(r.sniperPct ?? 0).toFixed(0)}%` : "—"),
  },
  {
    key: "top10",
    label: "Top 10",
    value: (r) => r.top10Pct,
    title: "Share held by the largest wallets",
    cell: (r) =>
      r.top10Pct != null ? <span className={r.top10Pct >= TOP10_WARN ? "text-warning" : ""}>{r.top10Pct.toFixed(0)}%</span> : "—",
  },
];

/** Dense ranked table for desktop. The column the category ranks by is highlighted. */
export function TokenTable({
  rows,
  now,
  metric,
  startRank = 1,
  moves,
  sparks,
  launches,
  smart,
}: {
  rows: DiscoverRow[];
  now: number;
  metric: MetricKey;
  startRank?: number;
  moves?: Map<string, number>;
  /** Recent USD prices per coin, for the mini chart. */
  sparks?: Record<string, number[]>;
  /** Our launch records (dev history, bundles) and smart-wallet counts, for safety. */
  launches?: Map<string, FeedToken>;
  smart?: Record<string, number>;
}) {
  const open = useOpenToken();
  // Click a header to sort by it (high to low, then low to high, then the ranking).
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const col = sort ? COLUMNS.find((c) => c.key === sort.key) : undefined;
  const sorted = col
    ? [...rows].sort((a, b) => {
        const x = col.value(a);
        const y = col.value(b);
        if (x == null) return 1;
        if (y == null) return -1;
        return sort!.desc ? y - x : x - y;
      })
    : rows;
  const cycle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, desc: true } : s.desc ? { key, desc: false } : null));
  // Early buyers only matter for new launches: shown on the Sniped ranking.
  const cols = COLUMNS.filter((c) => c.key !== "snipers" || metric === "snipers");
  // The same safety score the badge shows, also handed to the analysis popup.
  const safetyOf = (r: DiscoverRow) => safetyScore(rowSignals(r, launches?.get(r.mint) ?? null, smart?.[r.mint] ?? 0, now / 1000));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-240 text-sm whitespace-nowrap">
        <thead>
          <tr className="h-10 border-b border-border text-left text-xs text-muted">
            <th className="w-12 pl-5 font-normal">#</th>
            <th className="pr-4 font-normal">Token</th>
            <th className="pr-3 font-normal" title="Safety score: 100 minus red flags. Hover a score for the reasons">Safety</th>
            <th className="pr-2 font-normal" title="Price over the last 30 minutes">30m</th>
            {cols.map((c) => (
              <th
                key={c.key}
                title={c.title}
                aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                className={`px-2 text-right font-normal ${c.wide ? WIDE : ""} ${c.metric === metric || sort?.key === c.key ? "text-emerald" : ""}`}
              >
                <button type="button" onClick={() => cycle(c.key)} className="inline-flex items-center gap-1 hover:text-text">
                  {c.label}
                  {sort?.key === c.key && (sort.desc ? <ArrowDown size={11} strokeWidth={1.5} /> : <ArrowUp size={11} strokeWidth={1.5} />)}
                </button>
              </th>
            ))}
            <th className="pr-4 pl-4" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.mint} onClick={open(r.mint)} className="group h-14 cursor-pointer border-b hover:shadow-[inset_2px_0_0_var(--mx-emerald)] border-border transition-colors duration-150 last:border-0 hover:bg-surface-2">
              <td className="pl-5 font-mono text-xs text-muted">
                <div className="flex flex-col leading-4">
                  {startRank + i}
                  <Move by={moves?.get(r.mint)} />
                </div>
              </td>
              <td className="pr-4">
                <div className="flex items-center gap-3">
                  <TokenLogo src={r.image} symbol={r.symbol} size={36} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="max-w-32 truncate font-medium text-text">{r.symbol || "—"}</span>
                      {r.verified && <BadgeCheck size={14} strokeWidth={1.5} className="shrink-0 text-cyan" aria-label="Verified" />}
                      <SourceTag row={r} />
                      <StarButton mint={r.mint} size={13} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs whitespace-nowrap">
                      <CopyMint mint={r.mint} />
                      <span className="font-mono text-muted">{age(r, now)}</span>
                      <Socials twitter={r.twitter} telegram={r.telegram} website={r.website} />
                    </div>
                  </div>
                </div>
              </td>
              <td className="pr-3">
                <SafetyBadge safety={safetyOf(r)} />
              </td>
              <td className="pr-2">
                <Sparkline points={sparks?.[r.mint]} width={60} />
              </td>
              {cols.map((c) => (
                <td key={c.key} className={`px-2 text-right font-mono text-xs ${c.wide ? WIDE : ""} ${c.metric === metric ? "text-text" : "text-text-2"}`}>
                  {c.cell(r, now)}
                </td>
              ))}
              <td className="pr-4 pl-4 text-right">
                <span className="inline-flex items-center gap-1.5">
                  <AiButton input={() => inputFromRow(r)} safety={safetyOf(r)} compact />
                  <QuickBuy mint={r.mint} symbol={r.symbol} />
                  <TradeLink mint={r.mint} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rank change since the previous update: ▲2 climbed two places, ▼1 dropped one. */
export function Move({ by }: { by: number | undefined }) {
  if (!by) return null;
  return (
    <span key={by} className={`fade-up font-mono text-[11px] ${by > 0 ? "text-positive" : "text-negative"}`} title="Rank change">
      {by > 0 ? "▲" : "▼"}
      {Math.abs(by)}
    </span>
  );
}

export function SourceTag({ row }: { row: DiscoverRow }) {
  return row.source === "launch" ? (
    <span className="shrink-0 rounded border border-emerald/30 px-1 font-mono text-[10px] leading-4 text-emerald">New</span>
  ) : null;
}
