"use client";

import { LiveTradesColumn } from "./live-trades-column";
import { CoinProfile } from "./coin-profile";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, Crosshair, Fish, Gauge, Globe, Send, Share2, UserCog, Users, UsersRound, type LucideIcon } from "lucide-react";
import { openShare } from "@/lib/share";
import { useFeatures } from "@/lib/features";
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
import { AiRiskChip } from "@/components/token/ai-risk-chip";
import { DevRecord } from "@/components/token/dev-record";
import { KolBadge } from "@/components/kols/kol-badge";
import { NoteButton } from "@/components/notes/note-button";
import { startTradeTour, TradeTour } from "@/components/tour/trade-tour";
import { CircleHelp } from "lucide-react";
import { money, signed } from "./trade-panel";
import { DockableTrade } from "./floating-trade";
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
  const [sideW, setSideW] = useStoredSize("mx.trade.sideW", 340, 300, 600);
  const [tapeW, setTapeW] = useStoredSize("mx.trade.tapeW", 290, 220, 520);
  const tapeShown = useWide();
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
    <div className="terminal flex flex-col pb-16 lg:pb-0">
      <Header row={row} launch={launch} market={market} now={now} book={book} solUsd={feed.solUsd} safety={safety} />

      <div className="flex flex-col lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[520px] md:h-(--chart-h)" style={{ "--chart-h": `${chartH}px` } as React.CSSProperties}>
            <section data-tour="trade-chart" className="h-full min-w-0 flex-1">
              <PriceChart
                symbol={row.symbol}
                mint={mint}
                book={book}
                solUsd={feed.solUsd}
                mcUsd={row.mcUsd}
                supply={row.mcUsd && row.priceUsd ? row.mcUsd / row.priceUsd : null}
              />
            </section>
            {/* The tape next to the chart on wide screens (resizable); smaller screens get
                the Trades tab below instead. */}
            {tapeShown && (
              <>
                <Splitter axis="col" value={tapeW} onChange={setTapeW} invert label="Resize live trades" />
                <div className="shrink-0" style={{ width: tapeW }}>
                  <LiveTradesColumn mint={mint} book={book} solUsd={feed.solUsd} supply={row.mcUsd && row.priceUsd ? row.mcUsd / row.priceUsd : null} now={now} />
                </div>
              </>
            )}
          </div>
          <Splitter axis="row" value={chartH} onChange={setChartH} label="Resize chart height" />
          <Activity mint={mint} book={book} solUsd={feed.solUsd} now={now} tapeShown={tapeShown} creator={launch?.creator ?? null} supply={row.mcUsd && row.priceUsd ? row.mcUsd / row.priceUsd : null} />
        </div>

        <Splitter axis="col" value={sideW} onChange={setSideW} invert label="Resize side panel" />
        <aside className="flex flex-col lg:w-(--side-w) lg:shrink-0" style={{ "--side-w": `${sideW}px` } as React.CSSProperties}>
          <FlowStrip row={row} book={book} solUsd={feed.solUsd} now={now} />
          <div id="trade-box" data-tour="trade-box" className="scroll-mt-16">
            <DockableTrade symbol={row.symbol} mint={mint} />
          </div>
          <MyPosition mint={mint} livePrice={row.priceUsd} />
          <CoinProfile row={row} launch={launch} market={market} now={now} />
          <TokenInfo row={row} launch={launch} />
        </aside>
      </div>
      <MobileTradeBar symbol={row.symbol} />
      <TradeTour />
    </div>
  );
}

/** Wide screens (the 2xl breakpoint) show the live trades column beside the chart. */
const WIDE = "(min-width: 1536px)";
function useWide() {
  return useSyncExternalStore(
    (f) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", f);
      return () => m.removeEventListener("change", f);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** Phones: the trade box sits below the chart and trades, so Buy and Sell stay at hand
 *  at the bottom of the screen and jump to it with that side picked. */
function MobileTradeBar({ symbol }: { symbol: string }) {
  const go = (side: "buy" | "sell") => {
    window.dispatchEvent(new CustomEvent("kixo:trade-side", { detail: side }));
    document.getElementById("trade-box")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 border-t border-border bg-bg/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <button type="button" onClick={() => go("buy")} className="h-11 rounded-lg bg-[#2ee59d] text-sm font-medium text-bg focus-visible:outline-2 focus-visible:outline-emerald">
        Buy {symbol}
      </button>
      <button type="button" onClick={() => go("sell")} className="h-11 rounded-lg bg-[#ff4d5e] text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-emerald">
        Sell
      </button>
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

/** Shares the coin as a card: its safety score and live facts, and how far it rose
 *  since launch when Kixo watched it from its first trade (the first candle of a
 *  bonding-curve book is its launch). */
function ShareCoinButton({ row: r, book, solUsd, safety, ageSecs }: { row: DiscoverRow; book: BookState; solUsd: number | null; safety: Safety | null; ageSecs: number }) {
  const f = useFeatures();
  if (!f.coin_share || !f.share_cards) return null;
  const first = book.status === "live" && book.source === "curve" && book.candles.length ? book.candles[0] : null;
  return (
    <button
      type="button"
      onClick={() =>
        openShare({
          kind: "coin",
          coin: {
            mint: r.mint,
            symbol: r.symbol,
            name: r.name,
            image: r.image,
            mcUsd: r.mcUsd,
            firstMcUsd: first && solUsd ? first.o * solUsd : null,
            firstSeen: first ? first.t : null,
            safety: safety?.score ?? null,
            holders: r.holders,
            top10Pct: r.top10Pct,
            liquidityUsd: r.liquidityUsd,
            ageSecs: Number.isFinite(ageSecs) ? ageSecs : null,
          },
        })
      }
      title="Share this coin as an image"
      aria-label="Share this coin as an image"
      className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-emerald"
    >
      <Share2 size={14} strokeWidth={1.5} /> <span className="tool-label">Share</span>
    </button>
  );
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
      {/* Row 1: identity, the market cap and price, tools */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-1.5">
        <Link
          href="/discover"
          aria-label="Back to Discover"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          <ArrowLeft size={15} strokeWidth={1.5} />
        </Link>

        <div className="flex min-w-0 items-center gap-2.5">
          <TokenLogo src={r.image} symbol={r.symbol} size={26} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <h1 className="max-w-40 truncate text-sm font-medium text-text">{r.symbol || "—"}</h1>
              {r.verified && <BadgeCheck size={13} strokeWidth={1.5} className="shrink-0 self-center text-cyan" aria-label="Verified" />}
              <span className="max-w-32 truncate text-xs text-muted">{r.name}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] leading-4">
              <CopyMint mint={r.mint} />
              <span className="font-mono text-muted" title="Age">
                {formatAge(ageSecs)}
              </span>
              {meta?.twitter && <IconLink href={meta.twitter} label="X / Twitter"><XGlyph /></IconLink>}
              {meta?.telegram && <IconLink href={meta.telegram} label="Telegram"><Send size={12} strokeWidth={1.5} /></IconLink>}
              {meta?.website && <IconLink href={meta.website} label="Website"><Globe size={12} strokeWidth={1.5} /></IconLink>}
            </div>
          </div>
        </div>

        <div className="flex items-baseline gap-3 font-mono tabular-nums">
          <Tick value={r.mcUsd} className="text-[15px] leading-5 text-text">
            {usd(r.mcUsd)}
          </Tick>
          <span className="text-xs text-text-2">
            <Tick value={r.priceUsd}>{price(r.priceUsd)}</Tick>
          </span>
          <span className="text-xs">
            <Change v={r.change5m} />
            <span className="ml-1 font-sans text-[11px] text-muted">5m</span>
          </span>
        </div>

        <div
          data-tour="trade-tools"
          className="ml-auto flex flex-wrap items-center gap-1 [&_a]:h-7 [&_a]:px-2 [&_a]:text-xs [&_button]:h-7 [&_button]:px-2 [&_button]:text-xs [&_.tool-label]:hidden min-[1800px]:[&_.tool-label]:inline"
        >
          {safety && <SafetyBadge safety={safety} size="sm" />}
          <AiRiskChip mint={r.mint} ageSecs={ageSecs} size="md" />
          <KolBadge mint={r.mint} size="md" />
          <span className="mx-1 h-4 w-px bg-border" />
          <BigMovesButton book={book} solUsd={solUsd} now={now} />
          <PriceAlertButton mint={r.mint} symbol={r.symbol} mcUsd={r.mcUsd} />
          <NoteButton kind="coin" target={r.mint} label={r.symbol} />
          <ShareCoinButton row={r} book={book} solUsd={solUsd} safety={safety} ageSecs={ageSecs} />
          <button type="button" onClick={startTradeTour} title="A walk through this page" aria-label="Page tour" className="flex w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text">
            <CircleHelp size={14} strokeWidth={1.5} />
          </button>
          <AiButton input={() => inputFromRow(r)} safety={safety} />
        </div>
      </div>

      {/* Row 2: every figure on one strip, the creator's record at its end */}
      <div className="flex items-center gap-4 border-t border-border px-3">
        <dl data-tour="trade-figures" className="no-scrollbar flex min-w-0 flex-1 items-center gap-x-4 overflow-x-auto py-1.5">
          <Cell k="1h" v={<Change v={r.change1h} />} />
          {market?.change_24h_pct != null && <Cell k="24h" v={<Change v={market.change_24h_pct} />} />}
          <Cell k="Liq" title="Liquidity" v={usd(r.liquidityUsd)} />
          <Cell k="Vol 1h" v={usd(r.vol1hUsd)} />
          {market?.volume_24h_usd != null && <Cell k="Vol 24h" v={usd(market.volume_24h_usd)} />}
          <Cell
            k="B/S 1h"
            title="Buys and sells in the last hour"
            v={
              <span>
                <span className="text-positive">{r.buys1h?.toLocaleString() ?? "—"}</span>
                <span className="text-muted">/</span>
                <span className="text-negative">{r.sells1h?.toLocaleString() ?? "—"}</span>
              </span>
            }
          />
          <Cell k="Holders" v={r.holders != null ? `${r.holdersApprox ? "~" : ""}${r.holders.toLocaleString()}` : "—"} />
          {market?.traders_1h != null && <Cell k="Traders 1h" v={market.traders_1h.toLocaleString()} title="Distinct wallets that traded in the last hour" />}
          {r.top10Pct != null && <Cell k="Top 10" v={<span className={r.top10Pct > TOP10_WARN ? "text-negative" : "text-text"}>{r.top10Pct.toFixed(1)}%</span>} />}
          {market?.organic_score != null && (
            <Cell
              k="Organic"
              title="0-100 estimate of how much trading comes from real wallets, not bots"
              v={<span className={market.organic_score >= 60 ? "text-positive" : market.organic_score >= 30 ? "text-warning" : "text-negative"}>{market.organic_score.toFixed(0)}</span>}
            />
          )}
          {market && (
            <Cell
              k="Mint/Freeze"
              title="Whether more tokens can be minted, and whether wallets can be frozen"
              v={
                <span>
                  <span className={market.mint_authority_disabled ? "text-positive" : "text-negative"}>{market.mint_authority_disabled ? "Off" : "On"}</span>
                  <span className="text-muted">/</span>
                  <span className={market.freeze_authority_disabled === false ? "text-negative" : "text-positive"}>{market.freeze_authority_disabled === false ? "On" : "Off"}</span>
                </span>
              }
            />
          )}
          {curve && (
            <Cell
              k={curve.complete ? "Graduated" : "Curve"}
              title="Bonding curve progress"
              v={
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full bg-emerald" style={{ width: `${Math.min(100, curve.curve_progress)}%` }} />
                  </span>
                  {curve.curve_progress.toFixed(0)}%
                </span>
              }
            />
          )}
          <Cell k="Supply" v={supply ? amount(supply) : "—"} />
          {ath != null && <Cell k="ATH" v={usd(ath)} title="Highest market cap since tracking started" />}
        </dl>
        {launch && <DevRecord report={launch.dev_report} creator={launch.creator} inline />}
      </div>
    </section>
  );
}

/** One figure in the header strip, separated by a hairline. */
function Cell({ k, v, title }: { k: string; v: React.ReactNode; title?: string }) {
  return (
    <div title={title} className="flex shrink-0 items-baseline gap-1.5 text-xs whitespace-nowrap">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="font-mono text-text tabular-nums">{v}</dd>
    </div>
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
    <section className="border-b border-border p-3">
      <h2 className="text-xs font-medium text-text">Token info</h2>
      <dl className="mt-2 grid grid-cols-3 gap-1.5">
        {tiles.map((t) => (
          <div key={t.k} className="flex flex-col items-center gap-0.5 rounded-md border border-border px-2 py-2 text-center">
            <dd className={`flex items-center gap-1.5 font-mono text-xs ${t.tone}`}>
              <t.icon size={12} strokeWidth={1.5} />
              {t.v}
            </dd>
            <dt className="text-[11px] text-muted">{t.k}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The demo position in this coin, figured exactly as a sale is:
 *  - Value: what selling it all now would bring, after the sale's fee and price impact
 *    (the gateway's own sell quote, the same one an order fills at).
 *  - PnL: that value minus what the open position cost, the same sum as the P&L on the
 *    sale's notification when it is sold now.
 *  - Realized: the P&L of the sales already made on this coin this round, the sum of
 *    their notifications.
 *  Between account refreshes (every 3 s) the value follows the chart's price by how much
 *  it moved since that refresh, never by comparing two different price sources. */
function MyPosition({ mint, livePrice }: { mint: string; livePrice: number | null }) {
  const { mode, trades, account } = useDemo();
  const mine = mode === "demo" ? (trades ?? []).filter((t) => t.mint === mint && t.round === (account?.round ?? 0)) : [];
  const realized = mine.filter((t) => t.side === "sell" && t.realized_usd != null).reduce((a, t) => a + Number(t.realized_usd), 0);
  const sales = mine.some((t) => t.side === "sell");
  const pos = mode === "demo" ? account?.positions.find((p) => p.mint === mint) : undefined;
  // The chart price when this account figure arrived: later moves scale the figure.
  // A refresh without a value (the price missed for a moment) keeps the last one shown for
  // this position, never a value of zero.
  const [base, setBase] = useState<{ of: unknown; price: number | null; value: number | null; key: string }>({ of: null, price: null, value: null, key: "" });
  const key = pos ? `${mint}:${pos.opened_at}:${pos.tokens}` : "";
  if (base.of !== account) setBase({ of: account, price: livePrice, value: pos?.value_usd ?? (base.key === key ? base.value : null), key });
  const ratio = base.of === account && base.price && livePrice ? livePrice / base.price : 1;
  // A chart price that jumps far between two refreshes (a feed switching source) is not a
  // market move: the figure waits for the next refresh instead.
  const scale = ratio > 0.5 && ratio < 2 ? ratio : 1;
  const known = pos?.value_usd ?? (base.key === key ? base.value : null);
  const value = pos && known != null ? known * scale : null;
  const cost = pos ? pos.cost_usd : null;
  const pnl = value != null && cost != null ? value - cost : null;
  const pct = pnl != null && cost ? (pnl / cost) * 100 : null;
  // Entry cost: the fee and impact paid on this position's buys (impact_pct includes the
  // fee). Break-even: the move needed for selling it all to bring back what it cost.
  const since = pos ? Date.parse(pos.opened_at) : 0;
  const entryCost = mine.filter((t) => t.side === "buy" && Date.parse(t.ts) >= since - 1000).reduce((a, t) => a + (Number(t.usd) * Number(t.impact_pct)) / (100 + Number(t.impact_pct)), 0);
  const breakEven = value && cost ? (cost / value - 1) * 100 : null;
  const toneOf = (v: number | null) => (v == null || Math.abs(v) < 0.005 ? "text-text-2" : v > 0 ? "text-positive" : "text-negative");
  const cells: [string, React.ReactNode][] = [
    ["Cost", <span key="c" className="text-text-2">{cost != null ? money(cost) : "—"}</span>],
    ["Value", value != null ? <Tick key="v" value={value} className="text-text">{money(value)}</Tick> : <span key="v" className="text-text-2">—</span>],
    [
      "PnL",
      pnl == null ? (
        <span key="p" className="text-text-2">—</span>
      ) : (
        <Tick key="p" value={pnl} className={toneOf(pnl)}>
          {signed(pnl)}
          {pct != null && <span className="block text-[11px] opacity-80">{`${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`}</span>}
        </Tick>
      ),
    ],
    ["Realized", sales ? <span key="r" className={toneOf(realized)}>{signed(realized)}</span> : <span key="r" className="text-text-2">—</span>],
  ];
  if (!mine.length && !pos) return null;
  return (
    <section className="border-b border-border">
      <div className="grid grid-cols-4 text-center">
        {cells.map(([k, v], i) => (
          <div key={k} className={`py-2 ${i ? "border-l border-border" : ""}`}>
            <div className="text-[11px] text-muted">{k}</div>
            <div className="mt-1 font-mono text-xs tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      {pos && (
        <p className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 border-t border-border px-3 py-2 text-[11px] text-muted" title="Value is what selling it all now would bring, after the sale fee and price impact, and PnL is that minus what the position cost: selling now shows the same PnL on its notification. Realized is the PnL of sales already made. Entry cost is the fee and price impact you paid when buying.">
          {entryCost > 0.005 && <span>Entry cost <span className="font-mono text-text-2">{money(entryCost)}</span></span>}
          {breakEven != null && (
            <span>
              Break-even <span className={`font-mono ${breakEven <= 0 ? "text-positive" : "text-text-2"}`}>{breakEven <= 0 ? "reached" : `+${breakEven.toFixed(1)}%`}</span>
            </span>
          )}
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
    <section className="border-b border-border px-3 py-2.5">
      <dl className="grid grid-cols-4 gap-2 font-mono text-xs">
        <div>
          <dt className="font-sans text-[11px] text-muted">{label} vol</dt>
          <dd className="mt-0.5 text-text">{usd(vol)}</dd>
        </div>
        <div>
          <dt className="font-sans text-[11px] text-muted">Buys</dt>
          <dd className="mt-0.5 text-positive">{buys ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-sans text-[11px] text-muted">Sells</dt>
          <dd className="mt-0.5 text-negative">{sells ?? "—"}</dd>
        </div>
        <div className="text-right">
          <dt className="font-sans text-[11px] text-muted">Net vol</dt>
          <dd className={`mt-0.5 ${net == null ? "text-muted" : net >= 0 ? "text-positive" : "text-negative"}`}>
            {net == null ? "—" : `${net >= 0 ? "+" : "−"}${usd(Math.abs(net))}`}
          </dd>
        </div>
      </dl>
      <div className="mt-2 flex h-1 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-full bg-positive transition-[width] duration-500" style={{ width: `${share}%` }} />
        <div className="flex-1 rounded-full bg-negative" />
      </div>
    </section>
  );
}


