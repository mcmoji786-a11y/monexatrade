"use client";

import { openWalletTracker } from "@/lib/tracker";
import Link from "next/link";
import { usePortfolio, useActivity, type Trade } from "@/lib/portfolio";
import { pct, sol, usd, type TradeRow } from "@/lib/gateway";
import { tokenHref } from "@/lib/open-token";
import { formatAge } from "@/components/radar/use-radar-feed";
import { TokenLogo } from "@/components/token/token-bits";

export type LiveTrade = { mint: string; symbol?: string | null; trade: TradeRow };

/** What a smart wallet holds now and how it has traded, from the chain: holdings with
 *  live prices, and its swaps on every DEX (stored, 30 days), with trades our engine sees
 *  arriving live on top. Loaded only when the wallet is opened. */
export function LeaderDetail({ wallet, live, now }: { wallet: string; live: LiveTrade[]; now: number }) {
  const port = usePortfolio(wallet);
  const act = useActivity(wallet);
  const p = port.data;
  const solUsd = p?.sol_usd ?? null;
  const tokens = (p?.tokens ?? []).filter((t) => (t.value_usd ?? 0) >= 1).sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0));
  const tokenValue = tokens.reduce((s, t) => s + (t.value_usd ?? 0), 0);
  const total = p && solUsd ? p.sol * solUsd + tokenValue : null;

  // Live trades first (they may not be in the stored history yet), then the history.
  const merged: Trade[] = [
    ...live.map((l) => ({ mint: l.mint, buy: l.trade.is_buy, sol: l.trade.sol, raw: "0", time: l.trade.ts, sig: l.trade.signature, symbol: l.symbol ?? "" })),
    ...(act.data ?? []),
  ];
  const seen = new Set<string>();
  const trades = merged.filter((t) => (seen.has(t.sig) ? false : (seen.add(t.sig), true))).sort((a, b) => b.time - a.time);
  const day = now ? now / 1000 - 86_400 : 0;
  const today = trades.filter((t) => t.time >= day);
  const boughtToday = today.filter((t) => t.buy).reduce((s, t) => s + t.sol, 0);
  const soldToday = today.filter((t) => !t.buy).reduce((s, t) => s + t.sol, 0);
  const symbolOf = (m: string, s: string) => s || tokens.find((t) => t.mint === m)?.symbol || `${m.slice(0, 4)}…`;

  return (
    <div className="fade-up grid gap-4 border-t border-border bg-bg/60 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <section>
        <header className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-text">Holds now</h3>
          <span className="font-mono text-xs text-muted">
            {total != null ? usd(total) : "…"}
            {p && <span className="ml-2">{sol(p.sol)}</span>}
          </span>
        </header>
        {!p ? (
          <p className="py-6 text-center text-xs text-muted">{port.error ?? "Reading the wallet"}</p>
        ) : tokens.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted">Only SOL in this wallet right now</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {tokens.slice(0, 8).map((t) => (
              <li key={t.mint}>
                <Link href={tokenHref(t.mint)} className="flex h-11 items-center gap-3 rounded-md px-1 text-sm hover:bg-surface-2">
                  <TokenLogo src={t.image} symbol={t.symbol} size={24} />
                  <span className="min-w-0 flex-1 truncate text-text">{t.symbol || `${t.mint.slice(0, 4)}…`}</span>
                  <span className={`w-16 text-right font-mono text-xs ${t.change_24h == null ? "text-muted" : t.change_24h >= 0 ? "text-positive" : "text-negative"}`}>{t.change_24h == null ? "—" : pct(t.change_24h)}</span>
                  <span className="w-20 text-right font-mono text-text">{usd(t.value_usd ?? 0)}</span>
                </Link>
              </li>
            ))}
            {tokens.length > 8 && <li className="pt-2 text-xs text-muted">and {tokens.length - 8} more</li>}
          </ul>
        )}
      </section>

      <section>
        <header className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium text-text">Recent trades</h3>
          <span className="flex gap-3 font-mono text-[11px] text-muted">
            <span>24h</span>
            <span className="text-positive">bought {sol(boughtToday)}</span>
            <span className="text-negative">sold {sol(soldToday)}</span>
          </span>
        </header>
        {!act.data && !live.length ? (
          <p className="py-6 text-center text-xs text-muted">{act.error ?? "Reading its trades on every DEX"}</p>
        ) : trades.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted">No swaps in the last 30 days</p>
        ) : (
          <ul className="mt-2 flex max-h-96 flex-col divide-y divide-border overflow-y-auto">
            {trades.slice(0, 40).map((t) => (
              <li key={t.sig + t.mint}>
                <Link href={tokenHref(t.mint)} className="flex h-10 items-center gap-3 rounded-md px-1 text-sm hover:bg-surface-2">
                  <span className="w-16 shrink-0 font-mono text-xs text-muted">{now ? `${formatAge(now / 1000 - t.time)} ago` : "—"}</span>
                  <span className={`inline-flex h-5 w-12 shrink-0 items-center justify-center rounded-full border text-[11px] ${t.buy ? "border-positive/30 text-positive" : "border-negative/30 text-negative"}`}>{t.buy ? "Buy" : "Sell"}</span>
                  <span className="min-w-0 flex-1 truncate text-text">{symbolOf(t.mint, t.symbol)}</span>
                  <span className="font-mono text-text">{sol(t.sol)}</span>
                  <span className="hidden w-16 text-right font-mono text-xs text-muted sm:block">{solUsd ? usd(t.sol * solUsd) : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => openWalletTracker(wallet)} className="mt-2 inline-block text-xs text-text-2 underline-offset-2 hover:text-text hover:underline">
          Open in the Wallet Tracker
        </button>
      </section>
    </div>
  );
}

/** The wallet's three largest holdings, for the top cards. */
export function TopHoldings({ wallet }: { wallet: string }) {
  const p = usePortfolio(wallet).data;
  if (!p) return <span className="text-xs text-muted">Reading holdings</span>;
  const top = p.tokens.filter((t) => (t.value_usd ?? 0) >= 1).sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0)).slice(0, 3);
  if (!top.length) return <span className="text-xs text-muted">Holding only SOL</span>;
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5">
      {top.map((t) => (
        <Link key={t.mint} href={tokenHref(t.mint)} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2 pl-0.5 font-mono text-[11px] text-text-2 transition-colors hover:border-cyan/40 hover:text-text">
          <TokenLogo src={t.image} symbol={t.symbol} size={16} />
          {t.symbol || `${t.mint.slice(0, 4)}…`}
          <span className="text-muted">{usd(t.value_usd ?? 0)}</span>
        </Link>
      ))}
    </span>
  );
}
