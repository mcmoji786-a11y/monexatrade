"use client";

import { WalletLink } from "@/components/tracker/wallet-tracker";

import { openWalletTracker } from "@/lib/tracker";
import { Fragment, useEffect, useRef, useState } from "react";
import { Brain, Check, Plus } from "lucide-react";
import { GATEWAY_HTTP, GATEWAY_WS, sol, type TradeRow } from "@/lib/gateway";
import { Move } from "@/components/discover/token-table";
import { formatAge, useNow } from "@/components/radar/use-radar-feed";
import { Tick } from "@/components/token/tick";
import { useMonitor } from "@/lib/prefs";
import { WalletDot } from "@/components/monitor/wallet-dot";
import { LeaderDetail, TopHoldings } from "./leader-detail";
import {
  TradesToggle,
} from "@/components/monitor/wallet-trades";

type Leader = {
  wallet: string;
  coins: number;
  wins: number;
  win_rate: number;
  realized_sol: number;
  avg_hold_secs: number;
  last_trade: number;
  holding: string[];
  /** Coins on which copying it 3 s late was simulated, and that copy's return in %. */
  copy_coins: number;
  copy_return_pct: number | null;
  sol_balance: number | null;
};
type Board = {
  tracking_secs: number;
  leaders: Leader[];
  symbols: Record<string, string>;
};

const REFRESH_MS = 15_000;

/** The rules a wallet passes to be listed (gateway devs.rs), shown so users can judge. */
const RULES = [
  "Profit on 3+ coins",
  "60%+ of coins in profit",
  "3+ SOL realised, 0.5+ SOL a coin",
  "Holds a coin 1+ minute on average",
  "Under 12 trades a coin, 30 coins an hour",
  "Holds 10 or fewer coins at once",
  "Traded in the last hour",
  "0.5+ SOL in the wallet now",
  "Human speed on chain",
  "Clone wallets merged",
];

const hold = (s: number) =>
  s >= 3600
    ? `${(s / 3600).toFixed(1)}h`
    : s >= 60
      ? `${Math.round(s / 60)}m`
      : `${s}s`;

/** Smart Money: wallets that keep taking profit on new Solana coins, from Kixo's own
 *  decoded trades. Selected automatically; bots that scalp every launch are left out. */
export function SmartMoneyBoard() {
  const [data, setData] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${GATEWAY_HTTP}/smart-money`, {
          cache: "no-store",
        });
        const body = (await res.json()) as Board;
        if (alive) {
          setData(body);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const [sort, setSort] = useState<"profit" | "copy">("profit");
  const leaders = sortLeaders(data?.leaders ?? [], sort);
  const now = useNow();
  const moves = useRankMoves(leaders.map((l) => l.wallet));
  const live = useLeaderTrades(leaders.slice(0, 50).map((l) => l.wallet));
  // One wallet open at a time; its trades show under it.
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (w: string) => setOpen((o) => (o === w ? null : w));
  const tradesOf = (w: string) => live.filter((t) => t.trade.wallet === w);
  const openTop = open && leaders.slice(0, 3).some((l) => l.wallet === open);
  const hours = data ? data.tracking_secs / 3600 : 0;
  const watched = data
    ? hours >= 1
      ? `${hours.toFixed(1)}h`
      : `${Math.round(hours * 60)}m`
    : "—";
  const total = leaders.reduce((s, l) => s + l.realized_sol, 0);
  const avgWin = leaders.length
    ? leaders.reduce((s, l) => s + l.win_rate, 0) / leaders.length
    : null;

  return (
    <section className="flex flex-col gap-6">
      {/* Title and key numbers */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text">Smart Money</h1>
            <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-text-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${failed ? "bg-warning" : "live-ring bg-emerald"}`}
              />
              {failed ? "Offline" : "Live"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Real traders who keep taking profit on new Solana coins, picked
            automatically from on-chain trades
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Stat
            label="Smart wallets"
            value={data ? String(leaders.length) : "—"}
            raw={leaders.length}
          />
          <Stat
            label="Realised by them"
            value={data ? sol(total) : "—"}
            raw={total}
            tone="text-positive"
          />
          <Stat
            label="Average win rate"
            value={avgWin != null ? `${avgWin.toFixed(0)}%` : "—"}
            raw={avgWin}
          />
          <Stat label="Watching for" value={watched} />
        </dl>
      </div>

      {/* What qualifies a wallet */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3">
        <span className="mr-1 text-xs text-muted">
          Every wallet here passed
        </span>
        {RULES.map((r) => (
          <span
            key={r}
            className="flex h-6 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-text-2"
          >
            <Check size={11} strokeWidth={1.5} className="text-positive" />
            {r}
          </span>
        ))}
      </div>

      {!data && (
        <p className="rounded-2xl border border-border bg-surface px-8 py-16 text-center text-sm text-muted">
          {failed ? "Gateway offline. Retrying" : "Loading"}
        </p>
      )}

      {data && leaders.length === 0 && <Scanning hours={hours} />}

      {leaders.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-border bg-surface p-1" role="group" aria-label="Sort wallets">
            {(
              [
                ["profit", "Most profit"],
                ["copy", "Best to copy"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={sort === k}
                onClick={() => setSort(k)}
                className={`h-8 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${sort === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="max-w-xl text-xs text-muted">
            Copy score: what you would have made copying each trade 3 seconds late, after
            0.5% fees each way. A wallet can win while its copiers lose
          </p>
        </div>
      )}

      {/* Top three */}
      {leaders.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          {leaders.slice(0, 3).map((l, i) => (
            <Podium
              key={l.wallet}
              leader={l}
              rank={i + 1}
              delay={i * 80}
              move={moves.get(l.wallet)}
              now={now}
              open={open === l.wallet}
              trades={tradesOf(l.wallet).length}
              onToggle={() => toggle(l.wallet)}
            />
          ))}
        </div>
      )}
      {openTop && (
        <div className="overflow-hidden rounded-2xl border border-cyan/30 bg-surface">
          <p className="flex items-center gap-2 px-4 pt-3 text-sm text-text">
            <WalletDot address={open!} size={16} />
            Wallet #{leaders.findIndex((l) => l.wallet === open) + 1}
          </p>
          <LeaderDetail wallet={open!} live={tradesOf(open!)} now={now} />
        </div>
      )}

      {/* Everyone else */}
      {leaders.length > 3 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-220 text-sm whitespace-nowrap">
            <thead>
              <tr className="h-10 border-b border-border text-left text-xs text-muted">
                <th className="w-12 pl-5 font-normal">#</th>
                <th className="font-normal">Wallet</th>
                <th className="px-3 text-right font-normal">Realised profit</th>
                <th className="w-48 px-3 font-normal">Win rate</th>
                <th className="px-3 text-right font-normal">Avg hold</th>
                <th className="px-3 text-right font-normal">Last trade</th>
                <th className="px-3 text-right font-normal">Copy score</th>
                <th className="px-3 text-right font-normal">SOL now</th>
                <th className="pr-5" />
              </tr>
            </thead>
            <tbody>
              {leaders.slice(3).map((l, i) => (
                <Fragment key={l.wallet}>
                  <tr
                    onClick={() => toggle(l.wallet)}
                    className={`fade-up h-12 cursor-pointer border-b border-border hover:bg-surface-2 ${open === l.wallet ? "bg-surface-2" : ""}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  >
                    <td className="pl-5 font-mono text-xs text-muted">
                      <span className="flex flex-col leading-4">
                        {i + 4}
                        <Move by={moves.get(l.wallet)} />
                      </span>
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <WalletDot address={l.wallet} />
                        <WalletLink address={l.wallet} badges={false} />
                        <PortfolioLink wallet={l.wallet} />
                      </span>
                    </td>
                    <td className="px-3 text-right font-mono text-positive">
                      <Tick value={l.realized_sol}>+{sol(l.realized_sol)}</Tick>
                    </td>
                    <td className="px-3">
                      <WinBar rate={l.win_rate} wins={l.wins} coins={l.coins} />
                    </td>
                    <td className="px-3 text-right font-mono text-text-2">
                      {hold(l.avg_hold_secs)}
                    </td>
                    <td className="px-3 text-right font-mono text-xs text-text-2">
                      {now
                        ? `${formatAge(now / 1000 - l.last_trade)} ago`
                        : "—"}
                    </td>
                    <td className="px-3 text-right font-mono">
                      <CopyScore l={l} />
                    </td>
                    <td className="px-3 text-right font-mono text-text-2">
                      {l.sol_balance != null ? sol(l.sol_balance) : "—"}
                    </td>
                    <td className="pr-5 text-right">
                      <span className="inline-flex items-center gap-2">
                        <TradesToggle
                          open={open === l.wallet}
                          count={tradesOf(l.wallet).length}
                          onClick={() => toggle(l.wallet)}
                        />
                        <MonitorButton wallet={l.wallet} rank={i + 4} />
                      </span>
                    </td>
                  </tr>
                  {open === l.wallet && (
                    <tr className="border-b border-border">
                      <td colSpan={8} className="p-0">
                        <LeaderDetail wallet={l.wallet} live={tradesOf(l.wallet)} now={now} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="max-w-3xl text-xs leading-5 text-muted">
        Profit is realised on sells only, from trades Kixo decoded since it
        started watching. Past results do not predict future ones, and following
        a wallet is not a recommendation.
      </p>
    </section>
  );
}

function Podium({
  leader: l,
  rank,
  delay,
  move,
  now,
  open,
  trades,
  onToggle,
}: {
  leader: Leader;
  rank: number;
  delay: number;
  move?: number;
  now: number;
  open: boolean;
  trades: number;
  onToggle: () => void;
}) {
  return (
    <article
      onClick={onToggle}
      className={`fade-up flex cursor-pointer flex-col gap-4 rounded-2xl border bg-surface p-5 transition-colors hover:bg-surface-2 ${open ? "border-cyan/40" : "border-border"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <WalletDot address={l.wallet} size={28} />
          <WalletLink address={l.wallet} badges={false} />
          <PortfolioLink wallet={l.wallet} />
        </span>
        <span className="flex items-center gap-2 font-mono text-xs text-muted">
          <Move by={move} />#{rank}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <Tick
          value={l.realized_sol}
          className="font-mono text-3xl text-positive"
        >
          +{sol(l.realized_sol)}
        </Tick>
        <span className="text-xs text-muted">realised</span>
      </div>
      <WinBar rate={l.win_rate} wins={l.wins} coins={l.coins} />
      <dl className="grid grid-cols-4 gap-2 border-t border-border pt-3 font-mono text-xs">
        <div>
          <dt className="font-sans text-[11px] text-muted">Coins sold</dt>
          <dd className="mt-0.5 text-text">{l.coins}</dd>
        </div>
        <div>
          <dt className="font-sans text-[11px] text-muted">Avg hold</dt>
          <dd className="mt-0.5 text-text">{hold(l.avg_hold_secs)}</dd>
        </div>
        <div>
          <dt className="font-sans text-[11px] text-muted">Last trade</dt>
          <dd className="mt-0.5 text-text">
            {now ? `${formatAge(now / 1000 - l.last_trade)} ago` : "—"}
          </dd>
        </div>
        <div>
          <dt className="font-sans text-[11px] text-muted">Copy score</dt>
          <dd className="mt-0.5">
            <CopyScore l={l} />
          </dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3">
        <TopHoldings wallet={l.wallet} />
        <span className="flex items-center gap-2">
          <TradesToggle open={open} count={trades} onClick={onToggle} />
          <MonitorButton wallet={l.wallet} rank={rank} />
        </span>
      </div>
    </article>
  );
}

/** Wallets with a measured copy return first, best first; the rest by profit. */
function sortLeaders(list: Leader[], by: "profit" | "copy") {
  if (by === "profit") return list;
  return [...list].sort((a, b) => (b.copy_return_pct ?? -Infinity) - (a.copy_return_pct ?? -Infinity) || b.realized_sol - a.realized_sol);
}

/** Return of a follower copying the wallet 3 s late; "Measuring" until one copied coin sold. */
function CopyScore({ l }: { l: Leader }) {
  if (l.copy_return_pct == null)
    return (
      <span className="text-xs text-muted" title="Shown once copying it was simulated on 3 coins">
        Measuring <span className="font-mono">{Math.min(l.copy_coins, 3)}/3</span>
      </span>
    );
  const v = l.copy_return_pct;
  return (
    <span className={v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-text-2"} title={`Copying it on ${l.copy_coins} coin${l.copy_coins === 1 ? "" : "s"}`}>
      {v >= 0 ? "+" : "−"}
      {Math.abs(v).toFixed(1)}%
    </span>
  );
}

/** Win rate as a bar: the share of coins it sold at a profit. */
function WinBar({
  rate,
  wins,
  coins,
}: {
  rate: number;
  wins: number;
  coins: number;
}) {
  return (
    <div
      className="flex items-center gap-2"
      title={`${wins} of ${coins} coins sold at a profit`}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className="grow-x h-full rounded-full bg-positive"
          style={{ width: `${Math.min(100, rate)}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-xs text-text">
        {rate.toFixed(0)}%{" "}
        <span className="text-muted">
          {wins}/{coins}
        </span>
      </span>
    </div>
  );
}

/** Before anyone qualifies: how long Kixo has watched, against the time it takes. */
function Scanning({ hours }: { hours: number }) {
  const progress = Math.min(100, (hours / 2) * 100);
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-8 py-14 text-center">
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border">
        <span className="live-ring absolute inset-0 rounded-full" />
        <Brain size={18} strokeWidth={1.5} className="text-muted" />
      </span>
      <p className="text-sm text-text">
        Watching every trade for wallets that keep winning
      </p>
      <p className="max-w-md text-xs text-muted">
        A wallet needs profit on 3 or more coins, at a human pace, to be listed.
        Most real traders show up within the first couple of hours
      </p>
      <div className="mt-1 h-1 w-64 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-cyan transition-[width] duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="font-mono text-[11px] text-muted">
        {hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(hours * 60)}m`}{" "}
        watched
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  raw,
  tone = "text-text",
}: {
  label: string;
  value: string;
  raw?: number | null;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-2xl ${tone}`}>
        <Tick value={raw}>{value}</Tick>
      </dd>
    </div>
  );
}

/** Sends a smart wallet to the user's Wallet Monitor. */
function MonitorButton({ wallet, rank }: { wallet: string; rank: number }) {
  const m = useMonitor();
  const on = m.has(wallet);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (on) m.remove(wallet);
        else m.add(wallet, `Smart #${rank}`);
      }}
      aria-pressed={on}
      title={
        on
          ? "In your Wallet Monitor. Click to remove"
          : "Add to Wallet Monitor: alerts when this wallet buys or sells"
      }
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors ${
        on
          ? "border-emerald/40 text-emerald"
          : "border-border text-text-2 hover:bg-surface-2 hover:text-text"
      }`}
    >
      {on ? (
        <Check size={13} strokeWidth={1.5} />
      ) : (
        <Plus size={13} strokeWidth={1.5} />
      )}
      {on ? "Monitoring" : "Monitor"}
    </button>
  );
}

/** Rank change per wallet since the previous refresh: positive = climbed. */
function useRankMoves(order: string[]) {
  const prev = useRef<Map<string, number>>(new Map());
  const [moves, setMoves] = useState<Map<string, number>>(new Map());
  const key = order.join(",");
  useEffect(() => {
    const next = new Map<string, number>();
    order.forEach((w, i) => {
      const was = prev.current.get(w);
      if (was != null && was !== i) next.set(w, was - i);
    });
    if (prev.current.size) setMoves(next);
    prev.current = new Map(order.map((w, i) => [w, i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return moves;
}

type LiveTrade = { mint: string; symbol: string | null; trade: TradeRow };

/** Trades by the listed wallets as they happen (gateway /ws/wallets). */
function useLeaderTrades(wallets: string[]) {
  const key = wallets.slice().sort().join(",");
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  useEffect(() => {
    if (!key) return;
    const ws = new WebSocket(
      `${GATEWAY_WS}/ws/wallets?w=${encodeURIComponent(key)}`,
    );
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "history") setTrades(msg.trades.slice(0, 30));
      if (msg.type === "trade")
        setTrades((cur) =>
          [
            { mint: msg.mint, symbol: msg.symbol, trade: msg.trade },
            ...cur,
          ].slice(0, 30),
        );
    };
    return () => {
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close();
    };
  }, [key]);
  return key ? trades : [];
}

/** Opens the wallet in the Wallet Tracker panel. */
function PortfolioLink({ wallet }: { wallet: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openWalletTracker(wallet);
      }}
      className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
    >
      Track
    </button>
  );
}
