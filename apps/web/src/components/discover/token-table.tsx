"use client";
import { TradeLink } from "@/components/token/trade-link";
import { useOpenToken } from "@/lib/open-token";
import { Socials } from "@/components/token/socials";
import { AiButton } from "@/components/token/ai-analysis";
import { Sparkline } from "@/components/token/sparkline";
import { inputFromRow } from "@/lib/ai";

import { BadgeCheck } from "lucide-react";
import type { DiscoverRow, MetricKey } from "@/lib/categories";
import { pct, price, usd } from "@/lib/gateway";
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
};

export const changeTone = (v: number | null | undefined) =>
  v == null ? "text-muted" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-text-2";

export const age = (r: DiscoverRow, now: number) => (r.createdAt && now ? formatAge(now / 1000 - r.createdAt) : "—");

const COLUMNS: Col[] = [
  { key: "price", label: "Price", cell: (r) => <Tick value={r.priceUsd}>{price(r.priceUsd)}</Tick> },
  {
    key: "c5",
    label: "5m",
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
    cell: (r) => (
      <Tick value={r.change1h} className={changeTone(r.change1h)}>
        {pct(r.change1h)}
      </Tick>
    ),
  },
  { key: "mc", label: "MC", cell: (r) => <Tick value={r.mcUsd}>{usd(r.mcUsd)}</Tick> },
  { key: "liq", label: "Liquidity", cell: (r) => usd(r.liquidityUsd) },
  { key: "v5", metric: "volume5m", label: "Vol 5m", cell: (r) => <Tick value={r.vol5mUsd}>{usd(r.vol5mUsd)}</Tick> },
  { key: "v1h", label: "Vol 1h", cell: (r) => <Tick value={r.vol1hUsd}>{usd(r.vol1hUsd)}</Tick> },
  {
    key: "trades",
    metric: "trades",
    label: "Buys/Sells 1h",
    cell: (r) =>
      r.buys1h != null ? (
        <>
          <span className="text-positive">{r.buys1h.toLocaleString()}</span>
          <span className="text-muted"> / </span>
          <span className="text-negative">{(r.sells1h ?? 0).toLocaleString()}</span>
        </>
      ) : (
        "—"
      ),
  },
  {
    key: "holders",
    label: "Holders",
    cell: (r) => (r.holders != null ? <Tick value={r.holders}>{`${r.holdersApprox ? "~" : ""}${r.holders.toLocaleString()}`}</Tick> : "—"),
  },
  {
    key: "snipers",
    metric: "snipers",
    label: "Early buyers",
    title: "New launches: wallets that bought within 3 s · share they still hold",
    cell: (r) => (r.snipers != null ? `${r.snipers} · ${(r.sniperPct ?? 0).toFixed(0)}%` : "—"),
  },
  {
    key: "top10",
    label: "Top 10",
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
}: {
  rows: DiscoverRow[];
  now: number;
  metric: MetricKey;
  startRank?: number;
  moves?: Map<string, number>;
  /** Recent USD prices per coin, for the mini chart. */
  sparks?: Record<string, number[]>;
}) {
  const open = useOpenToken();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-280 text-sm whitespace-nowrap">
        <thead>
          <tr className="h-10 border-b border-border text-left text-xs text-muted">
            <th className="w-12 pl-5 font-normal">#</th>
            <th className="pr-4 font-normal">Token</th>
            <th className="pr-2 font-normal" title="Price over the last 30 minutes">30m</th>
            {COLUMNS.map((c) => (
              <th key={c.key} title={c.title} className={`px-2 text-right font-normal ${c.metric === metric ? "text-emerald" : ""}`}>
                {c.label}
              </th>
            ))}
            <th className="sticky right-0 bg-surface pr-4 pl-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
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
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs whitespace-nowrap">
                      <CopyMint mint={r.mint} />
                      <span className="font-mono text-muted">{age(r, now)}</span>
                      <Socials twitter={r.twitter} telegram={r.telegram} website={r.website} />
                    </div>
                  </div>
                </div>
              </td>
              <td className="pr-2">
                <Sparkline points={sparks?.[r.mint]} />
              </td>
              {COLUMNS.map((c) => (
                <td key={c.key} className={`px-2 text-right font-mono text-xs ${c.metric === metric ? "text-text" : "text-text-2"}`}>
                  {c.cell(r, now)}
                </td>
              ))}
              <td className="sticky right-0 bg-surface pr-4 pl-2 text-right transition-colors duration-150 group-hover:bg-surface-2">
                <span className="inline-flex items-center gap-1.5">
                  <AiButton input={() => inputFromRow(r)} compact />
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
