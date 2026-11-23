"use client";
/* Kixo AI's next minutes (ai/scalp.py, trained by ai/train_scalp.py): from the trade page's
   live book, the chance the coin is up 10% within a minute, up 20% within two, up 50%
   within five, down 15% within two, and that a scalp (+20% before -10%, two minutes at
   most) works. Asked every few seconds while the coin trades on its launch curve, the
   market the model learned on. */
import { useEffect, useRef, useState } from "react";
import { GATEWAY_HTTP, type TradeRow } from "@/lib/gateway";
import type { BookState } from "@/components/trade/use-token-book";

export type Scalp = {
  scalp_win: number;
  up10_1m: number;
  up20_2m: number;
  up50_5m: number;
  down15_2m: number;
  /** The tested line: at or above it, a scalp is worth taking (null before training). */
  line: number | null;
  proven: boolean;
  /** When it was worked out (ms). */
  at: number;
};

const EVERY_MS = 4000;
/** pump.fun curves start at about 28 SOL of market cap. */
const PUMP_START_MC = 27.96;

export function useScalp(mint: string, book: BookState, launchTs: number | null, launchpad: string | null, enabled: boolean): Scalp | null {
  const [v, setV] = useState<{ mint: string; s: Scalp | null }>({ mint, s: null });
  const bookRef = useRef(book);
  useEffect(() => {
    bookRef.current = book;
  });
  const live = enabled && book.status === "live" && book.source === "curve";
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const ask = async () => {
      const b = bookRef.current;
      if (b.status !== "live" || b.trades.length < 3) return;
      const now = Date.now() / 1000;
      const recent: TradeRow[] = b.trades.filter((t) => t.ts >= now - 125);
      if (recent.length < 3) return;
      const peak = b.candles.reduce((m, c) => Math.max(m, c.h), 0);
      const first = launchpad === "pump.fun" ? PUMP_START_MC : (b.candles[0]?.o ?? recent[recent.length - 1].mc_sol);
      try {
        const r = await fetch(`${GATEWAY_HTTP}/ai/scalp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            now,
            age_s: launchTs ? now - launchTs : 0,
            peak_mc: peak,
            first_mc: first,
            trades: recent.map((t) => ({ ts: t.ts, sol: t.sol, mc_sol: t.mc_sol, is_buy: t.is_buy, wallet: t.wallet, dev: t.dev, sniper: t.sniper, bundler: !!t.bundler })),
          }),
        });
        if (!r.ok) return;
        const s = (await r.json()) as Omit<Scalp, "at">;
        if (alive) setV({ mint, s: { ...s, at: Date.now() } });
      } catch {
        // next round
      }
    };
    void ask();
    const id = setInterval(ask, EVERY_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mint, live, launchTs, launchpad]);
  return live && v.mint === mint ? v.s : null;
}

/** How the next minutes look, in one word. */
export function scalpRead(s: Scalp | null): "hot" | "weak" | "mixed" | null {
  if (!s) return null;
  if ((s.line != null && s.scalp_win >= s.line) || (s.up20_2m >= 0.45 && s.down15_2m < 0.4)) return "hot";
  if (s.up10_1m < 0.2 || s.down15_2m >= 0.6) return "weak";
  return "mixed";
}
