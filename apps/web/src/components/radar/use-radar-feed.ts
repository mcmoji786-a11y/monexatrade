"use client";

import { useEffect, useState } from "react";
import { GATEWAY_WS, type FeedEvent, type FeedToken } from "@/lib/gateway";

export type RadarToken = FeedToken & { arrived?: boolean };
export type FeedStatus = "connecting" | "live" | "reconnecting";

/** Subscribes to the gateway's live board and reconnects with backoff. The gateway
 *  already drops dead tokens, so this list is only what is worth showing. */
export function useRadarFeed() {
  const [tokens, setTokens] = useState<RadarToken[]>([]);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedStatus>("connecting");

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 1000;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(`${GATEWAY_WS}/ws/new-tokens`);
      ws.onopen = () => {
        setStatus("live");
        delay = 1000;
      };
      ws.onmessage = (e) => {
        const msg: FeedEvent = JSON.parse(e.data);
        switch (msg.type) {
          case "snapshot":
            setTokens(msg.tokens);
            setSolUsd(msg.sol_usd);
            break;
          case "token":
            setTokens((prev) =>
              prev.some((t) => t.mint === msg.token.mint) ? prev : [{ ...msg.token, arrived: true }, ...prev],
            );
            break;
          case "meta":
            setTokens((prev) => prev.map((t) => (t.mint === msg.mint ? { ...t, meta: msg.meta } : t)));
            break;
          case "market": {
            if (msg.sol_usd != null) setSolUsd(msg.sol_usd);
            const byMint = new Map(msg.items.map((m) => [m.mint, m]));
            setTokens((prev) => prev.map((t) => (byMint.has(t.mint) ? { ...t, market: byMint.get(t.mint)! } : t)));
            break;
          }
          case "removed": {
            const gone = new Set(msg.mints);
            setTokens((prev) => prev.filter((t) => !gone.has(t.mint)));
            break;
          }
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("reconnecting");
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { tokens, solUsd, status };
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
