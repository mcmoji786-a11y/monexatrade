"use client";

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
import { useTokenBook, useWallets, type BookState } from "./use-token-book";
import { riskOf, type Risk } from "@/lib/risk";
import { TradePanel, money, signed } from "./trade-panel";
import { ExitOrders } from "./exit-orders";
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
  const wallets = useWallets(mint, book.status === "live", null);
  const risk = useMemo(
    () => (row ? riskOf(row, launch?.market ?? null, market, wallets?.dev ?? null) : null),
    [row, launch, market, wallets],
  );

  if (!row) {
    return <Missing mint={mint} loading={!direct.settled} />;
  }

  return (
    <div className="terminal flex flex-col">
      <Header row={row} launch={launch} market={market} now={now} book={book} solUsd={feed.solUsd} risk={risk} />

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
          <TradePanel symbol={row.symbol} mint={mint} />
          <MyPosition mint={mint} livePrice={row.priceUsd} />
          <ExitOrders mint={mint} livePrice={row.priceUsd} />
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
  risk,
}: {
  row: DiscoverRow;
  launch: FeedToken | null;
  market: MarketToken | null;
  now: number;
  book: BookState;
  solUsd: number | null;
  risk: Risk | null;
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
          {risk && <RiskBadge risk={risk} />}
          <BigMovesButton book={book} solUsd={solUsd} now={now} />
          <PriceAlertButton mint={r.mint} symbol={r.symbol} mcUsd={r.mcUsd} />
          <AiButton input={() => inputFromRow(r)} />
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
          <Row k="Creator" v={<CopyMint mint={launch.creator} />} />
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

/** Bought, sold, holding and PnL for the connected wallet; empty until wallet connect. */
/** Your position in this coin: the demo account in demo mode. */
/** The demo position in this coin. Holding and P&L move with every trade on the chart:
 *  the gateway's sell-now value (after price impact and fees) is scaled by the live price
 *  between its refreshes, so the figure is both instant and honest. */
function MyPosition({ mint, livePrice }: { mint: string; livePrice: number | null }) {
  const { mode, trades, account } = useDemo();
  const mine = mode === "demo" ? (trades ?? []).filter((t) => t.mint === mint && t.round === (account?.round ?? 0)) : [];
  const bought = mine.filter((t) => t.side === "buy").reduce((a, t) => a + Number(t.usd), 0);
  const sold = mine.filter((t) => t.side === "sell").reduce((a, t) => a + Number(t.usd), 0);
  const pos = mode === "demo" ? account?.positions.find((p) => p.mint === mint) : undefined;
  const holding = !pos
    ? 0
    : pos.value_usd != null && pos.price_usd && livePrice
      ? pos.value_usd * (livePrice / pos.price_usd)
      : (pos.value_usd ?? 0);
  const pnl = mine.length ? sold + holding - bought : null;
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
    <section className="grid grid-cols-4 border-b border-border text-center">
      {cells.map(([k, v], i) => (
        <div key={k} className={`py-3 ${i ? "border-l border-border" : ""}`}>
          <div className="text-[11px] text-muted">{k}</div>
          <div className="mt-1 font-mono text-xs tabular-nums">{v}</div>
        </div>
      ))}
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

const RISK_TONE = {
  low: "text-positive border-positive/30",
  medium: "text-warning border-warning/30",
  high: "text-negative border-negative/30",
} as const;

/** Score with its reasons on hover and keyboard focus. */
function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-describedby="risk-reasons"
        className={`flex h-9 items-center gap-2 rounded-lg border px-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-emerald ${RISK_TONE[risk.level]}`}
      >
        <span className="text-sm">{risk.score}</span>
        <span className="font-sans capitalize">{risk.level} risk</span>
      </button>
      <div
        id="risk-reasons"
        role="tooltip"
        className="invisible absolute top-full left-0 z-30 mt-2 w-72 rounded-lg border border-border bg-surface-2 p-3 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <div className="text-xs text-muted">Why this score</div>
        <ul className="mt-2 flex flex-col gap-1.5 text-xs text-text-2">
          {risk.reasons.map((x) => (
            <li key={x} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
              {x}
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted">Facts from on-chain data, not advice</div>
      </div>
    </div>
  );
}

