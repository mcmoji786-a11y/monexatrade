"use client";

import { WalletLink } from "@/components/tracker/wallet-tracker";
import { useState } from "react";
import { CoinLabelsContext, LABEL_ORDER, useCoinLabels, useSmartWallets, type CoinLabels, type WalletLabel } from "@/lib/labels";
import { CopyAddress } from "@/components/token/token-bits";
import { amount, positionPnl, sol, usd, type Position, type TradeRow } from "@/lib/gateway";
import { formatAge } from "@/components/radar/use-radar-feed";
import { useWallets, type BookState } from "./use-token-book";

const TABS = [
  { key: "trades", label: "Trades" },
  { key: "holders", label: "Holders" },
  { key: "traders", label: "Top traders" },
  { key: "dev", label: "Dev" },
  { key: "snipers", label: "Early buyers" },
  { key: "whales", label: "Whales" },
  { key: "positions", label: "Positions" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Lower panel of the trade page. All data comes from our own pump.fun decoder. */
export function Activity({
  mint,
  book,
  solUsd,
  now,
  creator,
  supply,
}: {
  mint: string;
  book: BookState;
  solUsd: number | null;
  now: number;
  creator: string | null;
  /** Token supply, to show market cap for DEX trades. */
  supply: number | null;
}) {
  const [tab, setTab] = useState<TabKey>("trades");
  // Who to show in the trades, holders and top traders lists.
  const [who, setWho] = useState<WalletLabel | "all">("all");
  const labels = useCoinLabels(mint);
  const smart = useSmartWallets();
  const labelsOf = (wallet: string, flags: (WalletLabel | false | undefined)[]) => {
    const all = new Set<WalletLabel>(labels[wallet] ?? []);
    if (smart.has(wallet)) all.add("smart");
    for (const f of flags) if (f) all.add(f);
    return all;
  };
  const tradeShown = (t: TradeRow) => who === "all" || labelsOf(t.wallet, [t.dev && "dev", t.sniper && "sniper", t.whale && "whale", t.bundler && "bundler"]).has(who);
  const walletShown = (p: Position) => who === "all" || labelsOf(p.wallet, [p.dev && "dev", p.sniper && "sniper", p.bundler && "bundler", p.big_buyer && "whale"]).has(who);
  const filterable = tab === "trades" || tab === "holders" || tab === "traders";
  const [focus, setFocus] = useState<string | null>(null);
  const needsWallets = book.status === "live" && tab !== "trades" && tab !== "whales";
  const wallets = useWallets(mint, needsWallets, tab === "positions" ? focus : null);
  // DEX trades (tokens outside our decoder) in the same row shape, priced in SOL.
  const trades: TradeRow[] =
    book.status === "live"
      ? book.trades
      : book.status === "dex" && solUsd
        ? book.history.trades.map((t) => ({
            signature: t.signature,
            ts: t.ts,
            wallet: t.wallet,
            is_buy: t.is_buy,
            sol: t.usd / solUsd,
            tokens: t.tokens,
            price_sol: t.price_usd / solUsd,
            mc_sol: supply ? (t.price_usd * supply) / solUsd : 0,
            whale: t.usd / solUsd >= 5,
            dev: false,
            sniper: false,
          }))
        : [];
  // Whales are kept apart by the gateway, so old ones stay after newer trades push
  // them out of the latest list.
  const whales: TradeRow[] = book.status === "live" ? book.whales : trades.filter((t) => t.whale);

  const count: Partial<Record<TabKey, number>> = {
    trades: trades.length,
    holders: wallets?.holder_count,
    snipers: wallets?.snipers.length,
    whales: whales.length,
  };

  return (
    <CoinLabelsContext.Provider value={labels}>
    <section className="min-h-[360px]">
      <div role="tablist" className="no-scrollbar flex h-11 items-center gap-1 overflow-x-auto border-b border-border px-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${
              tab === t.key ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"
            }`}
          >
            {t.label}
            {count[t.key] != null && <span className="font-mono text-[11px] text-muted">{count[t.key]}</span>}
          </button>
        ))}
      </div>
      {filterable && book.status !== "loading" && <WhoFilter who={who} setWho={setWho} labels={labels} smart={smart} />}

      {book.status === "loading" ? (
        <Empty>Loading</Empty>
      ) : book.status === "dex" && tab !== "trades" && tab !== "whales" ? (
        <Empty>
          Holders, top traders, dev and early buyers load once this coin&apos;s live pool is connected. Showing its recent pool trades
          for now
        </Empty>
      ) : book.status === "untracked" ? (
        <Empty>Loading trades from this coin&apos;s pool</Empty>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {tab === "trades" && <TradeTable trades={trades.filter(tradeShown)} solUsd={solUsd} now={now} empty={who === "all" ? undefined : "No trades by these wallets in the recent list"} />}
          {tab === "whales" && <TradeTable trades={whales} solUsd={solUsd} now={now} empty="No buys or sells of 5 SOL or more yet" />}
          {tab === "holders" && <WalletTable rows={wallets?.holders.filter(walletShown)} solUsd={solUsd} now={now} kind="holders" empty={who === "all" ? undefined : "None of the top holders have this label"} />}
          {tab === "traders" && <WalletTable rows={wallets?.top_traders.filter(walletShown)} solUsd={solUsd} now={now} kind="traders" empty={who === "all" ? undefined : "None of the top traders have this label"} />}
          {tab === "snipers" && <WalletTable rows={wallets?.snipers} solUsd={solUsd} now={now} kind="traders" empty="No wallet bought in the first 3 seconds" />}
          {tab === "dev" && (
            <>
              <WalletTable rows={wallets ? (wallets.dev ? [wallets.dev] : []) : undefined} solUsd={solUsd} now={now} kind="traders" empty="The dev has not traded since launch" />
              <TradeTable trades={trades.filter((t) => t.dev)} solUsd={solUsd} now={now} empty="No dev trades in recent history" />
              {creator && (
                <p className="border-t border-border px-4 py-3 text-xs text-muted">
                  <span className="flex items-center gap-2">
                    Creator wallet
                    <WalletLink address={creator} extra={["dev"]} />
                  </span>
                </p>
              )}
            </>
          )}
          {tab === "positions" && <Positions focus={focus} setFocus={setFocus} position={wallets?.focus ?? null} loaded={wallets != null} solUsd={solUsd} now={now} />}
        </div>
      )}
    </section>
    </CoinLabelsContext.Provider>
  );
}

const WHO_TEXT: Record<WalletLabel, string> = { dev: "Dev", smart: "Smart money", whale: "Whales", bundler: "Bundlers", sniper: "Snipers" };

/** Show only wallets with one label: the dev, smart money, whales, bundlers or snipers. */
function WhoFilter({ who, setWho, labels, smart }: { who: WalletLabel | "all"; setWho: (w: WalletLabel | "all") => void; labels: CoinLabels; smart: Set<string> }) {
  const count = (l: WalletLabel) => (l === "smart" ? Object.keys(labels).filter((w) => smart.has(w)).length : Object.values(labels).filter((ls) => ls.includes(l)).length);
  return (
    <div role="group" aria-label="Show wallets" className="no-scrollbar flex h-10 items-center gap-1 overflow-x-auto border-b border-border px-3">
      <span className="mr-1 shrink-0 text-xs text-muted">Show</span>
      {(["all", ...LABEL_ORDER] as const).map((k) => {
        const n = k === "all" ? null : count(k);
        return (
          <button
            key={k}
            type="button"
            aria-pressed={who === k}
            onClick={() => setWho(k)}
            className={`flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors ${who === k ? "bg-surface-3 text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
          >
            {k === "all" ? "All" : WHO_TEXT[k]}
            {n != null && n > 0 && <span className="font-mono text-[10px] text-muted">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

function TradeTable({ trades, solUsd, now, empty = "No trades yet" }: { trades: TradeRow[]; solUsd: number | null; now: number; empty?: string }) {
  if (!trades.length) return <Empty>{empty}</Empty>;
  return (
    <table className="w-full min-w-160 text-xs">
      <thead className="sticky top-0 bg-surface">
        <tr className="h-9 border-b border-border text-left text-muted">
          <th className="pl-4 font-normal">Age</th>
          <th className="font-normal">Type</th>
          <th className="text-right font-normal">MC</th>
          <th className="text-right font-normal">Amount</th>
          <th className="text-right font-normal">Total</th>
          <th className="pl-6 font-normal">Wallet</th>
          <th className="pr-4 text-right font-normal">Tx</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {trades.map((t) => (
          <tr
            key={t.signature + t.wallet + t.ts}
            className={`h-9 border-b border-border last:border-0 hover:bg-surface-2 ${now / 1000 - t.ts < 4 ? (t.is_buy ? "tick-up" : "tick-down") : ""}`}
          >
            <td className="pl-4 text-muted">{formatAge(now / 1000 - t.ts)}</td>
            <td className={t.is_buy ? "text-positive" : "text-negative"}>{t.is_buy ? "Buy" : "Sell"}</td>
            <td className="text-right text-text-2">{solUsd ? usd(t.mc_sol * solUsd) : sol(t.mc_sol)}</td>
            <td className="text-right text-text-2">{amount(t.tokens)}</td>
            <td className={`text-right ${t.is_buy ? "text-positive" : "text-negative"}`}>
              {solUsd ? usd(t.sol * solUsd) : sol(t.sol)}
              <span className="ml-1.5 text-muted">{t.sol >= 0.01 ? t.sol.toFixed(2) : t.sol.toFixed(4)}</span>
            </td>
            <td className="pl-6">
              <WalletCell wallet={t.wallet} flags={[t.dev && "dev", t.sniper && "sniper", t.whale && "whale", t.bundler && "bundler"]} />
            </td>
            <td className="pr-4 text-right">
              <span className="inline-flex justify-end">
                <CopyAddress value={t.signature} title="Copy transaction signature" className="text-muted" />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WalletTable({
  rows,
  solUsd,
  now,
  kind,
  empty = "No wallets yet",
}: {
  rows: Position[] | undefined;
  solUsd: number | null;
  now: number;
  kind: "holders" | "traders";
  empty?: string;
}) {
  if (!rows) return <Empty>Loading</Empty>;
  if (!rows.length) return <Empty>{empty}</Empty>;
  const money = (v: number) => (solUsd ? usd(v * solUsd) : sol(v));
  return (
    <table className="w-full min-w-170 text-xs">
      <thead className="sticky top-0 bg-surface">
        <tr className="h-9 border-b border-border text-left text-muted">
          <th className="w-10 pl-4 font-normal">#</th>
          <th className="font-normal">Wallet</th>
          <th className="text-right font-normal">Bought</th>
          <th className="text-right font-normal">Sold</th>
          <th className="text-right font-normal">PnL</th>
          <th className="text-right font-normal">Holding</th>
          <th className="text-right font-normal">{kind === "holders" ? "Share" : "Value"}</th>
          <th className="pr-4 text-right font-normal">Last</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((p, i) => {
          const pnl = positionPnl(p);
          return (
            <tr key={p.wallet} className="h-9 border-b border-border last:border-0 hover:bg-surface-2">
              <td className="pl-4 text-muted">{i + 1}</td>
              <td>
                <WalletCell wallet={p.wallet} flags={[p.dev && "dev", p.sniper && "sniper", p.bundler && "bundler", p.big_buyer && "whale"]} />
              </td>
              <td className="text-right text-positive">
                {money(p.bought_sol)}
                <span className="ml-1.5 text-muted">{p.buys}</span>
              </td>
              <td className="text-right text-negative">
                {money(p.sold_sol)}
                <span className="ml-1.5 text-muted">{p.sells}</span>
              </td>
              <td className={`text-right ${pnl > 0 ? "text-positive" : pnl < 0 ? "text-negative" : "text-text-2"}`}>
                {pnl > 0 ? "+" : ""}
                {money(pnl)}
              </td>
              <td className="text-right text-text-2">{p.balance > 0 ? amount(p.balance) : "Sold all"}</td>
              <td className="text-right text-text-2">{kind === "holders" ? `${p.pct.toFixed(2)}%` : money(p.value_sol)}</td>
              <td className="pr-4 text-right text-muted">{formatAge(now / 1000 - p.last_ts)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Look up any wallet's position. Becomes "your position" once wallet connect exists. */
function Positions({
  focus,
  setFocus,
  position,
  loaded,
  solUsd,
  now,
}: {
  focus: string | null;
  setFocus: (w: string | null) => void;
  position: Position | null;
  loaded: boolean;
  solUsd: number | null;
  now: number;
}) {
  const [draft, setDraft] = useState(focus ?? "");
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(draft.trim());
  return (
    <div>
      <form
        className="flex flex-wrap items-center gap-2 border-b border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setFocus(draft.trim());
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Wallet address"
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 font-mono text-xs text-text outline-none placeholder:text-muted focus:border-emerald/50"
        />
        <button
          type="submit"
          disabled={!valid}
          className="h-9 rounded-lg bg-surface-3 px-4 text-sm text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-muted"
        >
          Show position
        </button>
      </form>
      {!focus ? (
        <Empty>Paste any wallet to see its position in this token. Your own wallet shows here after wallet connect</Empty>
      ) : !loaded ? (
        <Empty>Loading</Empty>
      ) : position ? (
        <WalletTable rows={[position]} solUsd={solUsd} now={now} kind="traders" />
      ) : (
        <Empty>This wallet has not traded this token since we started tracking it</Empty>
      )}
    </div>
  );
}

/** A wallet with every label it has in this coin (and Smart Money), and Track. */
function WalletCell({ wallet, flags }: { wallet: string; flags: (WalletLabel | false | undefined)[] }) {
  return wallet ? (
    <WalletLink address={wallet} extra={flags} />
  ) : (
    // LaunchLab curves do not log the trader.
    <span className="text-muted" title="Not recorded for this coin">—</span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{children}</p>;
}
