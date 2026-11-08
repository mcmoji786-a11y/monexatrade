"use client";

import { WalletLink } from "@/components/tracker/wallet-tracker";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, Crosshair, Fish, Gauge, Globe, Send, UserCog, Users, UsersRound, type LucideIcon } from "lucide-react";
import { buildRows, type DiscoverRow } from "@/lib/categories";
import { GATEWAY_HTTP, amount, pct, price, usd, type FeedToken, type MarketToken } from "@/lib/gateway";
import { CopyMint, TokenLogo } from "@/components/token/token-bits";
import { Tick } from "@/components/token/tick";
import { formatAge, useNow, useRadarFeed } from "@/components/radar/use-radar-feed";
import { Activity } from "./activity";
import { BigMovesButton } from "./big-moves";
import { AiButton } from "@/components/token/ai-analysis";
import { PriceAlertButton } from "@/components/token/price-alerts";
import { inputFromRow } from "@/lib/ai";
import { PriceChart } from "./price-chart";
import { Splitter, useStoredSize } from "./splitter";
import { useTokenBook, type BookState } from "./use-token-book";
import { launchSignals, rowSignals, safetyScore, type Safety } from "@/lib/safety";
import { SafetyBadge } from "@/components/token/safety-badge";
import { money, signed } from "./trade-panel";
import { DockableTrade } from "./floating-trade";
import { OrdersCard } from "./orders-card";
import { GridCard } from "./grid-card";
import { useDemo } from "@/lib/demo";

/** Concentration above these levels is flagged. Facts, not advice. */
const TOP10_WARN = 30;
const DEV_WARN = 10;
const SNIPER_WARN = 10;

export function TokenView() {
  const { mint } = useParams<{ mint: string }>();
  const feed = useRadarFeed();
  const now = useNow();

  const launch = feed.tokens.find((t) => t.mint === mint) ?? null;
  const direct = useDirectMarket(mint, feed.markets[mint] == null);
  const market = feed.markets[mint] ?? direct.token;
  const baseRow = useMemo(
    () =>
      buildRows(launch ? [launch] : [], market ? { [mint]: market } : {}, feed.solUsd).find((r) => r.mint === mint) ??
      (launch ? bareLaunchRow(launch) : null),
    [launch, market, mint, feed.solUsd],
  );

  const book = useTokenBook(mint);
  // While trades stream live, the last on-chain trade is the price: header, chart and
  // trades then show one number. Provider figures (which lag) fill in otherwise.
  const lastTrade = book.status === "live" ? book.trades[0] : undefined;
  const row = useMemo(() => {
    if (!baseRow || !lastTrade || !feed.solUsd || !lastTrade.price_sol) return baseRow;
    return { ...baseRow, priceUsd: lastTrade.price_sol * feed.solUsd, mcUsd: lastTrade.mc_sol * feed.solUsd };
  }, [baseRow, lastTrade, feed.solUsd]);
  const [chartH, setChartH] = useStoredSize("mx.trade.chartH", 620, 320, 1100);
  const [sideW, setSideW] = useStoredSize("mx.trade.sideW", 380, 320, 600);
  // The same safety score as the coin's card on Radar and Discover: one number everywhere.
  const safety = useMemo(() => {
    if (!row || !now) return null;
    const smart = feed.smart[mint] ?? 0;
    return safetyScore(
      launch
        ? launchSignals(launch, market, { copyOfReal: false, sameSymbol: false, sameXAccount: false, smart, nowSecs: now / 1000 })
        : rowSignals(row, null, smart, now / 1000),
    );
  }, [row, launch, market, feed.smart, mint, now]);

  if (!row) {
    return <Missing mint={mint} loading={!direct.settled} />;
  }

  return (
    <div className="terminal flex flex-col">
      <Header row={row} launch={launch} market={market} now={now} book={book} solUsd={feed.solUsd} safety={safety} />

      <div className="flex flex-col lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <section className="h-[520px] md:h-(--chart-h)" style={{ "--chart-h": `${chartH}px` } as React.CSSProperties}>
            <PriceChart
              symbol={row.symbol}
              mint={mint}
              book={book}
              solUsd={feed.solUsd}
              mcUsd={row.mcUsd}
              supply={row.mcUsd && row.priceUsd ? row.mcUsd / row.priceUsd : null}
            />
          </section>
          <Splitter axis="row" value={chartH} onChange={setChartH} label="Resize chart height" />
          <Activity mint={mint} book={book} solUsd={feed.solUsd} now={now} creator={launch?.creator ?? null} supply={row.mcUsd && row.priceUsd ? row.mcUsd / row.priceUsd : null} />
        </div>

        <Splitter axis="col" value={sideW} onChange={setSideW} invert label="Resize side panel" />
        <aside className="flex flex-col lg:w-(--side-w) lg:shrink-0" style={{ "--side-w": `${sideW}px` } as React.CSSProperties}>
          <FlowStrip row={row} book={book} solUsd={feed.solUsd} now={now} />
          <DockableTrade symbol={row.symbol} mint={mint} />
          <MyPosition mint={mint} livePrice={row.priceUsd} />
          <OrdersCard mint={mint} symbol={row.symbol} />
          <GridCard mint={mint} symbol={row.symbol} />
          <TokenInfo row={row} launch={launch} />
          <Safety row={row} launch={launch} market={market} />
          {launch?.meta?.description && (
            <section className="border-b border-border p-4">
              <h2 className="text-sm font-medium text-text">About</h2>
              <p className="mt-2 text-sm leading-6 break-words text-text-2">{launch.meta.description}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A launch seen on chain but with no usable market yet (no trade since creation, or a
 *  non-SOL pair). Identity is known; figures stay empty until trades arrive. */
function bareLaunchRow(t: FeedToken): DiscoverRow {
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    image: t.meta?.image ?? null,
    source: "launch",
    createdAt: t.timestamp,
    priceUsd: null,
    mcUsd: null,
    liquidityUsd: null,
    change5m: null,
    change1h: null,
    vol5mUsd: null,
    vol1hUsd: null,
    buys1h: t.market?.buys_1h ?? null,
    sells1h: t.market?.sells_1h ?? null,
    holders: t.market?.holders ?? null,
    holdersApprox: true,
    top10Pct: t.market?.top10_pct ?? null,
    devPct: t.market?.dev_pct ?? null,
    snipers: t.market?.snipers ?? null,
    sniperPct: t.market?.sniper_pct ?? null,
    verified: false,
    change24h: null,
    vol24hUsd: null,
    mintAuthDisabled: null,
    freezeAuthDisabled: null,
    organicScore: null,
    twitter: t.meta?.twitter ?? null,
    telegram: t.meta?.telegram ?? null,
    website: t.meta?.website ?? null,
  };
}

const DIRECT_POLL_MS = 3000;

/** Tokens not on the live board (pruned, or never in a polled category) are fetched
 *  straight from the gateway by mint and refreshed every few seconds. */
function useDirectMarket(mint: string, needed: boolean) {
  const [state, setState] = useState<{ mint: string; token: MarketToken | null; settled: boolean }>({
    mint,
    token: null,
    settled: false,
  });
  useEffect(() => {
    if (!needed) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${GATEWAY_HTTP}/token/${encodeURIComponent(mint)}`, { cache: "no-store" });
        const token = res.ok ? ((await res.json()) as MarketToken | null) : null;
        // Keep the last good value through a failed refresh; settle on a definite answer.
        if (alive) setState((s) => ({ mint, token: token ?? (s.mint === mint ? s.token : null), settled: res.ok || res.status === 404 || s.settled }));
      } catch {
        if (alive) setState((s) => ({ ...s, mint, settled: true }));
      }
    };
    load();
    const id = setInterval(load, DIRECT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mint, needed]);
  return state.mint === mint ? state : { mint, token: null, settled: false };
}

function Header({
  row: r,
  launch,
  market,
  now,
  book,
  solUsd,
  safety,
}: {
  row: DiscoverRow;
  launch: FeedToken | null;
  market: MarketToken | null;
  now: number;
  book: BookState;
  solUsd: number | null;
  safety: Safety | null;
}) {
  // All-time high market cap since we started tracking (only our own launches).
  const athSol = book.status === "live" && book.candles.length ? Math.max(...book.candles.map((c) => c.h)) : null;
  const ath = athSol != null && solUsd ? athSol * solUsd : null;
  const supply = book.status === "live" ? book.supply : r.mcUsd && r.priceUsd ? r.mcUsd / r.priceUsd : null;
  const meta = launch?.meta;
  const ageSecs = r.createdAt != null ? now / 1000 - r.createdAt : NaN;
  const curve = launch?.market;

  return (
    <section className="border-b border-border bg-surface">
      {/* Identity and actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-3 pb-3">
        <Link
          href="/discover"
          aria-label="Back to Discover"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </Link>

        <TokenLogo src={r.image} symbol={r.symbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-lg font-medium text-text">{r.symbol || "—"}</h1>
            {r.verified && <BadgeCheck size={15} strokeWidth={1.5} className="shrink-0 self-center text-cyan" aria-label="Verified" />}
            <span className="truncate text-sm text-muted">{r.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2.5 text-xs">
            <CopyMint mint={r.mint} />
            <span className="h-3 w-px bg-border" />
            <span className="font-mono text-muted" title="Age">
              {formatAge(ageSecs)}
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="flex items-center gap-2">
              {meta?.twitter && <IconLink href={meta.twitter} label="X / Twitter"><XGlyph /></IconLink>}
              {meta?.telegram && <IconLink href={meta.telegram} label="Telegram"><Send size={13} strokeWidth={1.5} /></IconLink>}
              {meta?.website && <IconLink href={meta.website} label="Website"><Globe size={13} strokeWidth={1.5} /></IconLink>}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {safety && <SafetyBadge safety={safety} size="md" />}
          <BigMovesButton book={book} solUsd={solUsd} now={now} />
          <PriceAlertButton mint={r.mint} symbol={r.symbol} mcUsd={r.mcUsd} />
          <AiButton input={() => inputFromRow(r)} safety={safety} />
        </div>
      </div>

      {/* Figures: one strip, the market cap leads */}
      <dl className="no-scrollbar flex overflow-x-auto border-t border-border">
        <div className="flex shrink-0 flex-col justify-center px-4 py-2.5">
          <dt className="text-[11px] text-muted">Market cap</dt>
          <dd>
            <Tick value={r.mcUsd} className="font-mono text-xl leading-7 text-emerald">
              {usd(r.mcUsd)}
            </Tick>
          </dd>
        </div>
        <Cell k="Price" v={<Tick value={r.priceUsd}>{price(r.priceUsd)}</Tick>} />
        <Cell k="5m" v={<Change v={r.change5m} />} />
        <Cell k="1h" v={<Change v={r.change1h} />} />
        <Cell k="Liquidity" v={usd(r.liquidityUsd)} />
        <Cell k="Vol 1h" v={usd(r.vol1hUsd)} />
        <Cell k="Holders" v={r.holders != null ? `${r.holdersApprox ? "~" : ""}${r.holders.toLocaleString()}` : "—"} />
        <Cell k="Supply" v={supply ? amount(supply) : "—"} />
        {ath != null && <Cell k="ATH" v={usd(ath)} title="Highest market cap since tracking started" />}
        {market?.change_24h_pct != null && <Cell k="24h" v={<Change v={market.change_24h_pct} />} />}
        {market?.volume_24h_usd != null && <Cell k="Vol 24h" v={usd(market.volume_24h_usd)} />}
        <Cell
          k="Buys / sells 1h"
          v={
            <span>
              <span className="text-positive">{r.buys1h?.toLocaleString() ?? "—"}</span>
              <span className="text-muted"> / </span>
              <span className="text-negative">{r.sells1h?.toLocaleString() ?? "—"}</span>
            </span>
          }
        />
        {market?.traders_1h != null && <Cell k="Traders 1h" v={market.traders_1h.toLocaleString()} title="Distinct wallets that traded in the last hour" />}
        {r.top10Pct != null && (
          <Cell k="Top 10" v={<span className={r.top10Pct > TOP10_WARN ? "text-negative" : "text-text"}>{r.top10Pct.toFixed(1)}%</span>} />
        )}
        {market?.organic_score != null && (
          <Cell
            k="Organic score"
            title="0-100 estimate of how much trading comes from real wallets, not bots"
            v={<span className={market.organic_score >= 60 ? "text-positive" : market.organic_score >= 30 ? "text-warning" : "text-negative"}>{market.organic_score.toFixed(0)}</span>}
          />
        )}
        {market && (
          <Cell
            k="Mint / freeze"
            title="Whether more tokens can be minted, and whether wallets can be frozen"
            v={
              <span>
                <span className={market.mint_authority_disabled ? "text-positive" : "text-negative"}>{market.mint_authority_disabled ? "Off" : "On"}</span>
                <span className="text-muted"> / </span>
                <span className={market.freeze_authority_disabled === false ? "text-negative" : "text-positive"}>{market.freeze_authority_disabled === false ? "On" : "Off"}</span>
              </span>
            }
          />
        )}
        {curve && (
          <Cell
            k={curve.complete ? "Graduated" : "Bonding curve"}
            v={
              <span className="flex items-center gap-2">
                <span className="h-1 w-14 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full bg-emerald" style={{ width: `${Math.min(100, curve.curve_progress)}%` }} />
                </span>
                {curve.curve_progress.toFixed(1)}%
              </span>
            }
          />
        )}
      </dl>
    </section>
  );
}

/** One figure in the header strip, separated by a hairline. */
function Cell({ k, v, title }: { k: string; v: React.ReactNode; title?: string }) {
  return (
    <div title={title} className="flex shrink-0 flex-col justify-center border-l border-border px-4 py-2.5">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="mt-0.5 font-mono text-sm text-text">{v}</dd>
    </div>
  );
}

function Safety({ row: r, launch, market }: { row: DiscoverRow; launch: FeedToken | null; market: MarketToken | null }) {
  const m = launch?.market;
  return (
    <section className="border-b border-border p-4">
      <h2 className="text-sm font-medium text-text">Contract</h2>
      <dl className="mt-3 flex flex-col gap-2.5 text-sm">
        <Row k="Contract" v={<CopyMint mint={r.mint} />} />
        <Row k="Mint authority" v={market ? (market.mint_authority_disabled ? "Revoked" : "Active") : "—"} warn={market ? !market.mint_authority_disabled : false} />
        <Row
          k="Freeze authority"
          v={market?.freeze_authority_disabled == null ? "—" : market.freeze_authority_disabled ? "Revoked" : "Active"}
          warn={market?.freeze_authority_disabled === false}
        />
        {launch && (
          <Row k="Creator" v={<WalletLink address={launch.creator} extra={["dev"]} badges={false} />} />
        )}
      </dl>
      {m && !m.complete && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex justify-between text-xs text-muted">
            <span>Bonding curve</span>
            <span className="font-mono text-text-2">{m.curve_progress.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full bg-emerald" style={{ width: `${Math.min(100, m.curve_progress)}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

function Missing({ mint, loading }: { mint: string; loading: boolean }) {
  return (
    <section className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-surface p-6 text-center">
      <h1 className="text-base font-medium text-text">{loading ? "Loading token" : "Not a tracked Solana memecoin"}</h1>
      <p className="mt-2 text-sm text-text-2">
        {loading
          ? "Connecting to the live feed"
          : "Kixo shows Solana memecoins only. Stablecoins, wrapped majors, stocks and DeFi tokens are not listed, and inactive memecoins drop off the board"}
      </p>
      <p className="mt-4 font-mono text-xs break-all text-muted">{mint}</p>
      <Link href="/discover" className="mt-6 inline-flex h-9 items-center rounded-lg bg-surface-3 px-4 text-sm text-text hover:bg-surface-2">
        Back to Discover
      </Link>
    </section>
  );
}


function Row({ k, v, warn = false }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-2">{k}</dt>
      <dd className={`font-mono text-xs ${warn ? "text-warning" : "text-text"}`}>{v}</dd>
    </div>
  );
}

function Change({ v }: { v: number | null }) {
  return <span className={v == null ? "text-muted" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-text"}>{pct(v)}</span>;
}

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={label}
      aria-label={label}
      className="text-muted transition-colors hover:text-text"
    >
      {children}
    </a>
  );
}

function XGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.9 2H22l-7.4 8.5L23 22h-6.8l-5.3-7-6.1 7H1.7l7.9-9.1L1 2h7l4.8 6.4L18.9 2Zm-1.2 18h1.9L7.4 4H5.4l12.3 16Z" />
    </svg>
  );
}

/** Risk figures as tiles, value on top in its risk color, label underneath. */
function TokenInfo({ row: r, launch }: { row: DiscoverRow; launch: FeedToken | null }) {
  const m = launch?.market;
  const risk = (v: number | null, warn: number) => (v == null ? "text-muted" : v > warn ? "text-negative" : "text-positive");
  const pctOf = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "—");
  const tiles: { k: string; v: string; tone: string; icon: LucideIcon }[] = [
    { k: "Top 10 H.", v: pctOf(r.top10Pct), tone: risk(r.top10Pct, TOP10_WARN), icon: Users },
    { k: "Dev H.", v: pctOf(r.devPct), tone: risk(r.devPct, DEV_WARN), icon: UserCog },
    { k: "Early buyers H.", v: pctOf(r.sniperPct), tone: risk(r.sniperPct, SNIPER_WARN), icon: Crosshair },
    {
      k: "Holders",
      v: r.holders != null ? `${r.holdersApprox ? "~" : ""}${r.holders.toLocaleString()}` : "—",
      tone: "text-text",
      icon: UsersRound,
    },
    { k: "Whale buys 1h", v: m ? m.whale_buys_1h.toLocaleString() : "—", tone: "text-cyan", icon: Fish },
    {
      k: "Bonding curve",
      v: m ? (m.complete ? "Graduated" : `${m.curve_progress.toFixed(1)}%`) : "—",
      tone: m?.complete ? "text-positive" : "text-warning",
      icon: Gauge,
    },
  ];
  return (
    <section className="border-b border-border p-4">
      <h2 className="text-sm font-medium text-text">Token info</h2>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.k} className="flex flex-col items-center gap-1 rounded-lg border border-border px-2 py-3 text-center">
            <dd className={`flex items-center gap-1.5 font-mono text-sm ${t.tone}`}>
              <t.icon size={14} strokeWidth={1.5} />
              {t.v}
            </dd>
            <dt className="text-[11px] text-muted">{t.k}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The demo position in this coin. Holding and P&L are marked at the live price, as on
 *  every trading platform, and move with every trade on the chart. The costs are shown
 *  plainly under them: what entering cost, the move needed to break even after the sale's
 *  fee, and what selling now would bring. */
function MyPosition({ mint, livePrice }: { mint: string; livePrice: number | null }) {
  const { mode, trades, account } = useDemo();
  const mine = mode === "demo" ? (trades ?? []).filter((t) => t.mint === mint && t.round === (account?.round ?? 0)) : [];
  const bought = mine.filter((t) => t.side === "buy").reduce((a, t) => a + Number(t.usd), 0);
  const sold = mine.filter((t) => t.side === "sell").reduce((a, t) => a + Number(t.usd), 0);
  const pos = mode === "demo" ? account?.positions.find((p) => p.mint === mint) : undefined;
  // Gateway figures move with the live price between refreshes.
  const scale = pos?.market_usd && livePrice ? livePrice / pos.market_usd : 1;
  const holding = pos ? (pos.value_usd ?? 0) * scale : 0;
  const pnl = mine.length ? sold + holding - bought : null;
  // Costs of the open position: the buys' fee and impact (impact_pct includes the fee),
  // the move needed to break even after the sale fee, and the sell-now value.
  const since = pos ? Date.parse(pos.opened_at) : 0;
  const entryCost = mine.filter((t) => t.side === "buy" && Date.parse(t.ts) >= since - 1000).reduce((a, t) => a + (Number(t.usd) * Number(t.impact_pct)) / (100 + Number(t.impact_pct)), 0);
  const sellNow = pos?.exit_usd != null ? pos.exit_usd * scale : null;
  // The price move that would make the whole trade on this coin come out even: what was
  // spent, minus what earlier sales already brought back, against selling the rest now.
  const stillNeeded = bought - sold;
  const breakEven = pos && sellNow && sellNow > 0 ? (stillNeeded <= 0 ? -100 : (stillNeeded / sellNow - 1) * 100) : null;
  const pct = pnl != null && bought > 0 ? (pnl / bought) * 100 : null;
  const tone = pnl == null || Math.abs(pnl) < 0.005 ? "text-text-2" : pnl > 0 ? "text-positive" : "text-negative";
  const cells: [string, React.ReactNode][] = [
    ["Bought", <span key="b" className="text-text-2">{mine.length ? money(bought) : "—"}</span>],
    ["Sold", <span key="s" className="text-text-2">{mine.length ? money(sold) : "—"}</span>],
    ["Holding", pos ? <Tick key="h" value={holding} className="text-text">{money(holding)}</Tick> : <span key="h" className="text-text-2">—</span>],
    [
      "PnL",
      pnl == null ? (
        <span key="p" className="text-text-2">—</span>
      ) : (
        <Tick key="p" value={pnl} className={tone}>
          {signed(pnl)}
          {pct != null && <span className="block text-[11px] opacity-80">{`${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`}</span>}
        </Tick>
      ),
    ],
  ];
  return (
    <section className="border-b border-border">
      <div className="grid grid-cols-4 text-center">
        {cells.map(([k, v], i) => (
          <div key={k} className={`py-3 ${i ? "border-l border-border" : ""}`}>
            <div className="text-[11px] text-muted">{k}</div>
            <div className="mt-1 font-mono text-xs tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      {pos && (
        <p className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 border-t border-border px-3 py-2 text-[11px] text-muted" title="P&L is what selling now would bring, after the sale fee and price impact, so selling holds no surprise. Entry cost is the fee and price impact you paid when buying.">
          {entryCost > 0.005 && <span>Entry cost <span className="font-mono text-text-2">{money(entryCost)}</span></span>}
          {breakEven != null && (
            <span>
              Break-even <span className={`font-mono ${breakEven <= 0 ? "text-positive" : "text-text-2"}`}>{breakEven <= 0 ? "reached" : `+${breakEven.toFixed(1)}%`}</span>
            </span>
          )}
          {sellNow != null && <span>Sell now <span className="font-mono text-text-2">{money(sellNow)}</span></span>}
        </p>
      )}
    </section>
  );
}

const FLOW_WINDOW = 300;

/** Last five minutes of order flow, from our decoded trades when we have them,
 *  otherwise the provider's one-hour figures. */
function FlowStrip({ row: r, book, solUsd, now }: { row: DiscoverRow; book: BookState; solUsd: number | null; now: number }) {
  let label = "5m";
  let vol: number | null;
  let buys: number | null;
  let sells: number | null;
  let buyVol: number | null = null;
  let sellVol: number | null = null;
  if (book.status === "live" && now > 0) {
    const since = now / 1000 - FLOW_WINDOW;
    const recent = book.trades.filter((t) => t.ts >= since);
    const k = solUsd ?? 0;
    buys = recent.filter((t) => t.is_buy).length;
    sells = recent.length - buys;
    buyVol = recent.filter((t) => t.is_buy).reduce((a, t) => a + t.sol, 0) * k;
    sellVol = recent.filter((t) => !t.is_buy).reduce((a, t) => a + t.sol, 0) * k;
    vol = buyVol + sellVol;
  } else {
    label = "1h";
    vol = r.vol1hUsd;
    buys = r.buys1h;
    sells = r.sells1h;
  }
  const net = buyVol != null && sellVol != null ? buyVol - sellVol : null;
  const total = (buys ?? 0) + (sells ?? 0);
  const share = total ? ((buys ?? 0) / total) * 100 : 50;

  return (
    <section className="border-b border-border p-4">
      <dl className="grid grid-cols-4 gap-2 font-mono text-xs">
        <div>
          <dt className="text-[11px] text-muted">{label} vol</dt>
          <dd className="mt-1 text-text">{usd(vol)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">Buys</dt>
          <dd className="mt-1 text-positive">{buys ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">Sells</dt>
          <dd className="mt-1 text-negative">{sells ?? "—"}</dd>
        </div>
        <div className="text-right">
          <dt className="text-[11px] text-muted">Net vol</dt>
          <dd className={`mt-1 ${net == null ? "text-muted" : net >= 0 ? "text-positive" : "text-negative"}`}>
            {net == null ? "—" : `${net >= 0 ? "+" : "−"}${usd(Math.abs(net))}`}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex h-1 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-full bg-positive transition-[width] duration-500" style={{ width: `${share}%` }} />
        <div className="flex-1 rounded-full bg-negative" />
      </div>
    </section>
  );
}


