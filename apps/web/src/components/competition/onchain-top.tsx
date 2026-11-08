"use client";

import { useEffect, useState } from "react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { WalletLink } from "@/components/tracker/wallet-tracker";
import { useNow } from "@/components/radar/use-radar-feed";

type TopTrader = {
  wallet: string;
  coins: number;
  wins: number;
  win_rate: number;
  realized_sol: number;
  trades: number;
  best_sol: number;
  last_trade: number;
};
type TopBoard = { window: "24h" | "7d"; since: number; now: number; sol_usd: number | null; traders: TopTrader[] };

function useOnchainTop(window: "24h" | "7d") {
  const [state, setState] = useState<{ window: string; board: TopBoard | null; failed: boolean }>({ window, board: null, failed: false });
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${GATEWAY_HTTP}/competition/onchain?window=${window}`)
        .then((r) => (r.ok ? (r.json() as Promise<TopBoard>) : Promise.reject(new Error(String(r.status)))))
        .then((board) => alive && setState({ window, board, failed: false }))
        .catch(() => alive && setState((s) => ({ window, board: s.window === window ? s.board : null, failed: true })));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [window]);
  return state.window === window ? state : { window, board: null, failed: false };
}

const sol = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 2 })} SOL`;
const usd = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function ago(ts: number, nowMs: number) {
  const s = Math.max(0, Math.floor(nowMs / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Real Solana wallets ranked by the profit they took on new memecoins, from trades
 *  Kixo's engine read on chain. Shown under the demo competition. */
export function OnchainTop() {
  const [window, setWindow] = useState<"24h" | "7d">("24h");
  const { board, failed } = useOnchainTop(window);
  const now = useNow();
  const PLACES = ["1st", "2nd", "3rd"];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-medium text-text">
            Top memecoin traders on Solana
            <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-normal text-text-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" /> On chain
            </span>
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-2">Real wallets ranked by the profit they took on new Solana memecoins, read from chain by Kixo. Bots are left out</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1" role="group" aria-label="Period">
          {(
            [
              ["24h", "24 hours"],
              ["7d", "7 days"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={window === k}
              onClick={() => setWindow(k)}
              className={`h-8 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${window === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!board ? (
        <p className="rounded-2xl border border-border bg-surface px-8 py-12 text-center text-sm text-muted">{failed ? "On-chain board unavailable, retrying" : "Loading"}</p>
      ) : board.traders.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-8 py-12 text-center text-sm text-muted">No trader has closed 3 coins in profit in this period yet</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[820px] text-sm tabular-nums whitespace-nowrap">
            <thead>
              <tr className="h-10 border-b border-border text-left text-xs text-muted">
                <th className="w-20 pl-5 font-normal">Rank</th>
                <th className="font-normal">Wallet</th>
                <th className="px-3 text-right font-normal">Profit taken</th>
                <th className="px-3 text-right font-normal">Coins</th>
                <th className="px-3 text-right font-normal">Win rate</th>
                <th className="px-3 text-right font-normal">Best coin</th>
                <th className="px-5 text-right font-normal">Last trade</th>
              </tr>
            </thead>
            <tbody>
              {board.traders.map((t, i) => (
                <tr key={t.wallet} className="h-12 border-b border-border last:border-0">
                  <td className="pl-5 font-mono text-xs">{i < 3 ? <span className="text-emerald">{PLACES[i]}</span> : <span className="text-muted">#{i + 1}</span>}</td>
                  <td>
                    <WalletLink address={t.wallet} />
                  </td>
                  <td className="px-3 text-right font-mono">
                    <span className="text-positive">{sol(t.realized_sol)}</span>
                    {board.sol_usd != null && <span className="ml-2 text-xs text-muted">{usd(t.realized_sol * board.sol_usd)}</span>}
                  </td>
                  <td className="px-3 text-right font-mono text-text-2">{t.coins}</td>
                  <td className="px-3 text-right font-mono text-text-2">{Math.round(t.win_rate)}%</td>
                  <td className="px-3 text-right font-mono text-text-2">{sol(t.best_sol)}</td>
                  <td className="px-5 text-right font-mono text-xs text-muted">{now ? ago(t.last_trade, now) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Profit taken counts sells only, on the coins Kixo follows (pump.fun and other launchpads). Wallets are public on-chain addresses, not Kixo users. Not financial advice</p>
    </section>
  );
}
