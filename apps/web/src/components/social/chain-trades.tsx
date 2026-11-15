"use client";
/* Community, "All Solana": every trade Kixo's engine decodes across Solana's launchpads,
   live (gateway /ws/chain-trades). Real on-chain trades by any wallet, not Kixo users.
   Pointer over the list pauses it, so a row can be read and clicked. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GATEWAY_WS, type TradeRow } from "@/lib/gateway";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "@/components/token/token-bits";
import { WalletLink } from "@/components/tracker/wallet-tracker";
import { formatAge, useNow } from "@/components/radar/use-radar-feed";

type Row = { key: string; mint: string; symbol: string | null; image: string | null; trade: TradeRow; usd: number | null };
const MAX = 80;
const MINS = [0.5, 1, 5, 20];

export function ChainTrades() {
  const [min, setMin] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const held = useRef<Row[]>([]);
  const now = useNow();

  useEffect(() => {
    pausedRef.current = paused;
    // Unpausing shows what arrived meanwhile.
    if (!paused && held.current.length) {
      const add = held.current;
      held.current = [];
      setRows((cur) => [...add, ...cur].slice(0, MAX));
    }
  }, [paused]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      ws = new WebSocket(`${GATEWAY_WS}/ws/chain-trades?min_sol=${min}`);
      ws.onopen = () => setLive(true);
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data) as { mint: string; symbol: string | null; image: string | null; trade: TradeRow; sol_usd: number | null };
          const row: Row = { key: m.trade.signature + m.trade.wallet, mint: m.mint, symbol: m.symbol, image: m.image, trade: m.trade, usd: m.sol_usd ? m.trade.sol * m.sol_usd : null };
          if (pausedRef.current) held.current = [row, ...held.current].slice(0, MAX);
          else setRows((cur) => (cur.some((r) => r.key === row.key) ? cur : [row, ...cur].slice(0, MAX)));
        } catch {}
      };
      ws.onclose = () => {
        setLive(false);
        if (!stop) retry = setTimeout(open, 3_000);
      };
    };
    open();
    return () => {
      stop = true;
      clearTimeout(retry);
      if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws?.close();
      else ws?.close();
    };
  }, [min]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-text-2">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "live-ring bg-emerald" : "bg-muted"}`} />
          {paused ? "Paused while you look" : live ? "Live on-chain trades by any wallet" : "Connecting"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted">At least</span>
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Smallest trade">
            {MINS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => (setRows([]), setMin(v))}
                aria-pressed={min === v}
                className={`h-7 rounded-md px-2.5 font-mono text-xs transition-colors ${min === v ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
              >
                {v} SOL
              </button>
            ))}
          </div>
        </div>
      </div>
      <section
        className="rounded-xl border border-border bg-surface"
        onPointerEnter={(e) => e.pointerType === "mouse" && setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">{live ? `Waiting for the next trade of ${min} SOL or more` : "Connecting to the live stream"}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const t = r.trade;
              return (
                <li key={r.key} className="row-in flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
                  <span className={`w-9 shrink-0 text-xs ${t.is_buy ? "text-positive" : "text-negative"}`}>{t.is_buy ? "Buy" : "Sell"}</span>
                  <Link href={tokenHref(r.mint)} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                    <TokenLogo src={r.image} symbol={r.symbol ?? "?"} size={22} />
                    <span className="truncate text-text">{r.symbol ?? `${r.mint.slice(0, 4)}…`}</span>
                  </Link>
                  <span className="hidden gap-1 sm:flex">
                    {t.whale && <Tag>Whale</Tag>}
                    {t.dev && <Tag>Dev</Tag>}
                    {t.sniper && <Tag>Sniper</Tag>}
                  </span>
                  <span className="hidden w-28 truncate text-right font-mono text-xs sm:block">
                    <WalletLink address={t.wallet} className="text-text-2 hover:text-text" />
                  </span>
                  <span className="w-24 text-right font-mono text-xs text-text">
                    {t.sol.toFixed(2)} SOL
                    {r.usd != null && <span className="block text-[11px] text-muted">${r.usd >= 1000 ? `${(r.usd / 1000).toFixed(1)}K` : r.usd.toFixed(0)}</span>}
                  </span>
                  <span className="w-10 text-right font-mono text-xs text-muted">{now ? formatAge(now / 1000 - t.ts) : ""}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded border border-border px-1.5 py-px text-[10px] text-text-2">{children}</span>;
}
