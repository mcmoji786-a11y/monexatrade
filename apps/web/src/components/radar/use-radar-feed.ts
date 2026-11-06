"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { GATEWAY_WS, type FeedEvent, type FeedToken, type MarketToken } from "@/lib/gateway";

export type RadarToken = FeedToken & { arrived?: boolean };
export type FeedStatus = "connecting" | "live" | "reconnecting";

type Snapshot = {
  tokens: RadarToken[];
  /** Established tokens across Solana, keyed by mint. */
  markets: Record<string, MarketToken>;
  solUsd: number | null;
  /** Recent USD prices per coin (one point per 30 s, up to 30 minutes), oldest first. */
  sparks: Record<string, number[]>;
  status: FeedStatus;
  /** Date.now() of the last message from the gateway (0 = none yet). */
  updatedAt: number;
};

/* One shared WebSocket for the whole page, however many components read the feed.
   It opens with the first subscriber and closes when the last one unmounts. */

const INITIAL: Snapshot = { tokens: [], markets: {}, solUsd: null, sparks: {}, status: "connecting", updatedAt: 0 };

/** Same sampling as the gateway (main.rs SPARK_EVERY / SPARK_POINTS). */
const SPARK_EVERY_MS = 30_000;
const SPARK_POINTS = 60;
const sparkAt: Record<string, number> = {};

function withSamples(sparks: Record<string, number[]>, items: { mint: string; price: number | null | undefined }[]) {
  const now = Date.now();
  let next: Record<string, number[]> | null = null;
  for (const { mint, price } of items) {
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    next ??= { ...sparks };
    const s = next[mint] ? [...next[mint]] : [];
    if (s.length && now - (sparkAt[mint] ?? 0) < SPARK_EVERY_MS) s[s.length - 1] = price;
    else {
      s.push(price);
      sparkAt[mint] = now;
      if (s.length > SPARK_POINTS) s.shift();
    }
    next[mint] = s;
  }
  return next ?? sparks;
}
let state: Snapshot = INITIAL;
const listeners = new Set<() => void>();
let ws: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let delay = 1000;

function set(next: Partial<Snapshot>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function apply(msg: FeedEvent) {
  switch (msg.type) {
    case "snapshot":
      set({
        tokens: msg.tokens,
        solUsd: msg.sol_usd,
        markets: Object.fromEntries((msg.markets ?? []).map((t) => [t.mint, t])),
        sparks: msg.sparks ?? {},
      });
      break;
    case "markets": {
      const markets = { ...state.markets };
      for (const t of msg.items) markets[t.mint] = t;
      // Coins our engine prices keep one source for their chart.
      const own = new Set(state.tokens.filter((t) => t.market?.sol_quoted).map((t) => t.mint));
      set({ markets, sparks: withSamples(state.sparks, msg.items.filter((t) => !own.has(t.mint)).map((t) => ({ mint: t.mint, price: t.price_usd }))) });
      break;
    }
    case "markets_removed": {
      const markets = { ...state.markets };
      for (const m of msg.mints) delete markets[m];
      set({ markets });
      break;
    }
    case "token":
      if (!state.tokens.some((t) => t.mint === msg.token.mint)) {
        set({ tokens: [{ ...msg.token, arrived: true }, ...state.tokens] });
      }
      break;
    case "meta":
      set({ tokens: state.tokens.map((t) => (t.mint === msg.mint ? { ...t, meta: msg.meta } : t)) });
      break;
    case "market": {
      const byMint = new Map(msg.items.map((m) => [m.mint, m]));
      set({
        solUsd: msg.sol_usd ?? state.solUsd,
        tokens: state.tokens.map((t) => (byMint.has(t.mint) ? { ...t, market: byMint.get(t.mint)! } : t)),
        sparks: withSamples(state.sparks, msg.items.map((m) => ({ mint: m.mint, price: m.price_usd }))),
      });
      break;
    }
    case "removed": {
      const gone = new Set(msg.mints);
      set({ tokens: state.tokens.filter((t) => !gone.has(t.mint)) });
      break;
    }
  }
}

function connect() {
  const socket = new WebSocket(`${GATEWAY_WS}/ws/new-tokens`);
  ws = socket;
  socket.onopen = () => {
    delay = 1000;
    set({ status: "live" });
  };
  socket.onmessage = (e) => {
    state = { ...state, updatedAt: Date.now() };
    apply(JSON.parse(e.data));
  };
  socket.onclose = () => {
    // A socket we already replaced or closed on purpose must not touch the current one.
    if (ws !== socket) return;
    ws = null;
    if (listeners.size === 0) return;
    set({ status: "reconnecting" });
    retry = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000);
  };
}

/** How long the socket stays open after the last subscriber leaves. Page navigation
 *  and React's development double-mount unsubscribe and resubscribe immediately;
 *  without this grace period the socket was closed while still connecting. */
const CLOSE_GRACE_MS = 1000;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  clearTimeout(closeTimer);
  if (!ws) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    closeTimer = setTimeout(() => {
      if (listeners.size > 0) return;
      clearTimeout(retry);
      const socket = ws;
      ws = null;
      state = INITIAL;
      socket?.close();
    }, CLOSE_GRACE_MS);
  };
}

/** Live Sol Radar board. The gateway already drops dead tokens. */
export function useRadarFeed(): Snapshot {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

/** Re-render every second so ages tick. Starts at 0 (unknown) so the server
 *  prerender never bakes in a timestamp; the clock starts in the browser. */
export function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

export function formatAge(secs: number) {
  if (!Number.isFinite(secs) || secs < -60) return "—"; // clock not started yet
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
