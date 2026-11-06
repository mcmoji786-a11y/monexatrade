"use client";

import { useEffect, useState } from "react";
import { GATEWAY_HTTP, GATEWAY_WS, type BookSnapshot, type Candle, type DexHistory, type TradeRow, type Wallets } from "@/lib/gateway";

export type BookState =
  | { status: "loading" }
  | { status: "untracked" }
  /** Not a pump.fun launch we decode: history from its main Solana DEX pool. */
  | { status: "dex"; history: DexHistory }
  | { status: "live"; source: string; pool: string | null; trades: TradeRow[]; candles: Candle[]; candleSecs: number; supply: number };

const MAX_TRADES = 500;

/** Folds one trade into the base candles (same rule as the gateway). */
function addTrade(candles: Candle[], secs: number, t: TradeRow): Candle[] {
  const bucket = t.ts - (((t.ts % secs) + secs) % secs);
  const last = candles[candles.length - 1];
  if (last && last.t === bucket) {
    const next = { ...last, h: Math.max(last.h, t.mc_sol), l: Math.min(last.l, t.mc_sol), c: t.mc_sol, v: last.v + t.sol };
    return [...candles.slice(0, -1), next];
  }
  if (last && bucket < last.t) return [...candles.slice(0, -1), { ...last, v: last.v + t.sol }];
  const o = last ? last.c : t.mc_sol;
  return [...candles, { t: bucket, o, h: Math.max(o, t.mc_sol), l: Math.min(o, t.mc_sol), c: t.mc_sol, v: t.sol }];
}

/** Live trade book for one launch over its own WebSocket, with reconnect. */
/** Graduated pump.fun coins stay live: the gateway streams their PumpSwap pool into the
 *  same book. Other DEX coins fall back to polled pool history. */
export function useTokenBook(mint: string): BookState {
  const [state, setState] = useState<{ mint: string; book: BookState }>({ mint, book: { status: "loading" } });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let delay = 1000;
    const set = (fn: (b: BookState) => BookState) => setState((s) => ({ mint, book: fn(s.mint === mint ? s.book : { status: "loading" }) }));

    // DEX history, refreshed every 10 s (the gateway caches it for everyone).
    let dexTimer: ReturnType<typeof setInterval> | undefined;
    const loadDex = (onMissing?: () => void) => {
      let found = false;
      const load = async () => {
        try {
          const res = await fetch(`${GATEWAY_HTTP}/token/${encodeURIComponent(mint)}/dex`, { cache: "no-store" });
          if (closed) return;
          // `null`: no pool known yet (or the indexer is busy); try again next round.
          const history = res.ok ? ((await res.json()) as DexHistory | null) : null;
          if (closed) return;
          if (!history) {
            if (!found && onMissing) {
              clearInterval(dexTimer);
              onMissing();
            }
            return;
          }
          found = true;
          set(() => ({ status: "dex", history }));
        } catch {
          // keep what we have
        }
      };
      load();
      dexTimer = setInterval(load, 10_000);
    };

    const connect = () => {
      const ws = new WebSocket(`${GATEWAY_WS}/ws/token/${encodeURIComponent(mint)}`);
      socket = ws;
      let untracked = false;
      ws.onmessage = (e) => {
        delay = 1000;
        const msg = JSON.parse(e.data) as { type: "book"; book: BookSnapshot } | { type: "trade"; trade: TradeRow } | { type: "untracked" };
        if (msg.type === "untracked") {
          untracked = true;
          set(() => ({ status: "untracked" }));
          loadDex();
        } else if (msg.type === "book") {
          const b = msg.book;
          set(() => ({ status: "live", source: b.source, pool: b.pool, trades: b.trades, candles: b.candles, candleSecs: b.candle_secs, supply: b.supply }));
        } else {
          set((b) =>
            b.status !== "live"
              ? b
              : { ...b, trades: [msg.trade, ...b.trades].slice(0, MAX_TRADES), candles: addTrade(b.candles, b.candleSecs, msg.trade) },
          );
        }
      };
      ws.onclose = () => {
        if (closed || untracked) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(dexTimer);
      // Closing a socket that is still connecting logs a browser error (React's
      // development double-mount does this); close it once it opens instead.
      if (socket?.readyState === WebSocket.CONNECTING) {
        const s = socket;
        s.onopen = () => s.close();
        s.onmessage = null;
      } else socket?.close();
    };
  }, [mint]);

  return state.mint === mint ? state.book : { status: "loading" };
}

/** Holders, top traders, dev and snipers, refreshed every few seconds while shown. */
export function useWallets(mint: string, enabled: boolean, focus: string | null) {
  const [data, setData] = useState<{ key: string; wallets: Wallets | null }>({ key: "", wallets: null });
  const key = `${mint}|${focus ?? ""}`;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const q = focus ? `?wallet=${encodeURIComponent(focus)}` : "";
        const res = await fetch(`${GATEWAY_HTTP}/token/${encodeURIComponent(mint)}/wallets${q}`, { cache: "no-store" });
        if (res.ok && alive) setData({ key, wallets: (await res.json()) as Wallets | null });
      } catch {
        // keep the last good value
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mint, enabled, focus, key]);

  return data.key === key ? data.wallets : null;
}
