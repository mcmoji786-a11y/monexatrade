"use client";

import { useEffect, useState } from "react";
import { GATEWAY_HTTP } from "./gateway";

/* A wallet's portfolio from the gateway: live holdings (chain + Jupiter prices) and its
   swaps among the latest 100 transactions, from which cost and profit are worked out. */

export type Holding = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  decimals: number;
  amount: number;
  raw: string;
  price_usd: number | null;
  value_usd: number | null;
  change_24h: number | null;
  mcap: number | null;
  liquidity: number | null;
  verified: boolean;
};

export type Portfolio = { wallet: string; sol: number; sol_usd: number | null; tokens: Holding[]; updated: number };
export type Trade = { mint: string; buy: boolean; sol: number; raw: string; time: number; sig: string; symbol: string };

type Load<T> = { data: T | null; error: string | null; loading: boolean };

function usePoll<T>(url: string | null, everyMs: number): Load<T> & { reload: () => void } {
  const [state, setState] = useState<Load<T>>({ data: null, error: null, loading: !!url });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = () =>
      fetch(url)
        .then(async (r) => {
          if (!r.ok) throw new Error(r.status === 502 ? "The chain data service is busy, retrying" : `Could not load (${r.status})`);
          return (await r.json()) as T;
        })
        .then((data) => alive && setState({ data, error: null, loading: false }))
        .catch((e: Error) => alive && setState((s) => ({ ...s, error: e.message, loading: false })));
    load();
    const t = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url, everyMs, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export const usePortfolio = (wallet: string | null) => usePoll<Portfolio>(wallet ? `${GATEWAY_HTTP}/wallet/${wallet}/portfolio` : null, 30_000);
export const useActivity = (wallet: string | null) => usePoll<Trade[]>(wallet ? `${GATEWAY_HTTP}/wallet/${wallet}/activity` : null, 60_000);

/** A trade Kixo saw live on a coin it follows: instant, no history lookup. */
export type LiveTrade = { mint: string; buy: boolean; sol: number; tokens: number; time: number; sig: string; symbol: string; image: string | null; price_sol: number };
export const useLiveTrades = (wallet: string | null) => usePoll<LiveTrade[]>(wallet ? `${GATEWAY_HTTP}/wallet/${wallet}/live` : null, 5_000);

export type CoinPnl = {
  mint: string;
  /** SOL paid per raw unit, from buys in the window. */
  avgCost: number | null;
  realizedSol: number;
  unrealizedSol: number | null;
  boughtSol: number;
  soldSol: number;
  trades: number;
};

/** Profit per coin from the swaps we can see. Tokens bought before the window have no
 *  known cost, so only the covered part is counted (never guessed). */
export function pnlByCoin(trades: Trade[], holdings: Holding[], solUsd: number | null): Map<string, CoinPnl> {
  const agg = new Map<string, { bSol: number; bRaw: bigint; sSol: number; sRaw: bigint; n: number }>();
  for (const t of trades) {
    const a = agg.get(t.mint) ?? { bSol: 0, bRaw: BigInt(0), sSol: 0, sRaw: BigInt(0), n: 0 };
    const raw = BigInt(t.raw);
    if (t.buy) {
      a.bSol += t.sol;
      a.bRaw += raw;
    } else {
      a.sSol += t.sol;
      a.sRaw += raw;
    }
    a.n++;
    agg.set(t.mint, a);
  }
  const held = new Map(holdings.map((h) => [h.mint, h]));
  const out = new Map<string, CoinPnl>();
  for (const [mint, a] of agg) {
    const bRaw = Number(a.bRaw), sRaw = Number(a.sRaw);
    const avg = bRaw > 0 ? a.bSol / bRaw : null;
    const covered = Math.min(sRaw, bRaw);
    const realized = avg != null && sRaw > 0 ? a.sSol * (covered / sRaw) - avg * covered : 0;
    let unrealized: number | null = null;
    const h = held.get(mint);
    if (avg != null && h && h.value_usd != null && solUsd) {
      const hRaw = Number(h.raw);
      const open = Math.min(hRaw, Math.max(0, bRaw - covered));
      if (open > 0 && hRaw > 0) unrealized = (h.value_usd / solUsd) * (open / hRaw) - avg * open;
    }
    out.set(mint, { mint, avgCost: avg, realizedSol: realized, unrealizedSol: unrealized, boughtSol: a.bSol, soldSol: a.sSol, trades: a.n });
  }
  return out;
}
