"use client";

import { useEffect, useRef } from "react";
import { execute, tradeErrorText, useVenue, type Venue } from "@/lib/execute";
import { cancelRealSells, fetchPrices, getRealOrders, ORDER_TEXT, trailStep, triggered, updateRealOrder, useRealOrders } from "@/lib/orders";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

const CHECK_MS = 2_000;

/** Mounted once in the app shell: watches this browser's real orders against the same
 *  live price the demo engine uses, and fills them with the unlocked Kixo wallet. Runs
 *  only while Kixo is open (the key never leaves the browser). */
export function RealOrderEngine() {
  const orders = useRealOrders();
  const { venue } = useVenue();
  const { solUsd } = useRadarFeed();
  const ctx = useRef<{ venue: Venue | null; solUsd: number | null }>({ venue, solUsd });
  useEffect(() => {
    ctx.current = { venue, solUsd };
  }, [venue, solUsd]);
  const active = orders.some((o) => o.status === "open");

  useEffect(() => {
    if (!active) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const open = getRealOrders().filter((o) => o.status === "open");
        if (!open.length) return;
        const prices = await fetchPrices([...new Set(open.map((o) => o.mint))]);
        for (const o of open) {
          const price = prices[o.mint];
          if (price == null) continue;
          let trigger = o.trigger;
          if (o.kind === "trail" && o.peak && o.trailPct) {
            const t = trailStep(o.peak, o.trailPct, price);
            trigger = t.trigger;
            if (t.high > o.peak) updateRealOrder(o.id, { peak: t.high, trigger: t.trigger });
          }
          if (!triggered(o.kind, trigger, price)) continue;
          // Real orders need the unlocked wallet; they wait (stay open) until it is.
          if (ctx.current.venue !== "real") continue;
          updateRealOrder(o.id, { status: "filling" });
          const label = ORDER_TEXT[o.kind].label;
          try {
            const f = await execute("real", { mint: o.mint, symbol: o.symbol, side: o.kind === "limit_buy" ? "buy" : "sell", sol: o.sol, fraction: o.fraction, solUsd: ctx.current.solUsd });
            updateRealOrder(o.id, { status: "filled", doneAt: Date.now(), signature: f.signature, note: `${o.kind === "limit_buy" ? "Spent" : "Received"} ${f.sol.toFixed(4)} SOL` });
            if (o.kind !== "limit_buy" && (o.fraction ?? 1) >= 0.999) cancelRealSells(o.mint, "Position closed");
            pushToast({ kind: "exit", tone: o.kind === "sl" ? "bad" : "good", title: `${label} filled on ${o.symbol || "your coin"} · real`, body: `${o.kind === "limit_buy" ? "Spent" : "Received"} ${f.sol.toFixed(4)} SOL`, href: tokenHref(o.mint) });
          } catch (e) {
            const msg = tradeErrorText(e);
            updateRealOrder(o.id, { status: "failed", doneAt: Date.now(), note: msg });
            pushToast({ tone: "bad", title: `${label} failed: ${o.symbol || "coin"}`, body: msg });
          }
        }
      } catch {
      } finally {
        busy = false;
      }
    };
    void tick();
    const t = setInterval(tick, CHECK_MS);
    return () => clearInterval(t);
  }, [active]);

  return null;
}
