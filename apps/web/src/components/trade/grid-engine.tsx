"use client";

import { useEffect, useRef } from "react";
import { execute, tradeErrorText, useVenue, type Venue } from "@/lib/execute";
import { useDemo } from "@/lib/demo";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { getGrids, gridStep, updateGrid, useGrids, type Grid } from "@/lib/grid";
import { kixoAddress } from "@/lib/kixo-wallet";
import { fetchPrices } from "@/lib/orders";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

const CHECK_MS = 3_000;

type Ctx = { venue: Venue | null; solUsd: number | null; demoHeld: (mint: string) => number };

/** How many tokens of a coin the venue holds now (to sell a grid slot's share of it). */
async function heldNow(c: Ctx, venue: Venue, mint: string): Promise<number> {
  if (venue === "demo") return c.demoHeld(mint);
  const w = kixoAddress();
  if (!w) return 0;
  const r = await fetch(`${GATEWAY_HTTP}/wallet/${w}/portfolio`, { cache: "no-store" });
  if (!r.ok) return 0;
  const v = (await r.json()) as { tokens?: { mint: string; amount: number }[] };
  return v.tokens?.find((t) => t.mint === mint)?.amount ?? 0;
}

async function stepGrid(g: Grid, price: number, c: Ctx) {
  const { slots, action } = gridStep(g.slots, price);
  if (!action) {
    if (slots.some((s, i) => s.state !== g.slots[i].state)) updateGrid(g.id, { slots });
    return;
  }
  const slot = slots[action.index];
  updateGrid(g.id, { slots, busy: true });
  try {
    if (action.kind === "buy") {
      const f = await execute(g.venue, { mint: g.mint, symbol: g.symbol, side: "buy", ...(g.venue === "demo" ? { usd: g.amount } : { sol: g.amount }), solUsd: c.solUsd });
      const cost = g.venue === "demo" ? (f.usd ?? g.amount) : f.sol;
      updateGrid(g.id, (cur) => ({
        busy: false,
        note: undefined,
        buys: cur.buys + 1,
        slots: cur.slots.map((s, i) => (i === action.index ? { ...s, state: "sell", tokens: f.tokens ?? 0, cost } : s)),
      }));
    } else {
      const held = await heldNow(c, g.venue, g.mint);
      if (held <= 0) {
        // Sold elsewhere: the slot starts over.
        updateGrid(g.id, (cur) => ({ busy: false, note: "The grid's tokens were sold outside the grid", slots: cur.slots.map((s, i) => (i === action.index ? { ...s, state: "buy", tokens: 0, cost: 0 } : s)) }));
        return;
      }
      const fraction = Math.min(1, slot.tokens / held);
      const f = await execute(g.venue, { mint: g.mint, symbol: g.symbol, side: "sell", fraction, solUsd: c.solUsd });
      const got = g.venue === "demo" ? (f.usd ?? 0) : f.sol;
      const profit = got - slot.cost;
      updateGrid(g.id, (cur) => ({
        busy: false,
        note: undefined,
        sells: cur.sells + 1,
        realized: cur.realized + profit,
        slots: cur.slots.map((s, i) => (i === action.index ? { ...s, state: "buy", tokens: 0, cost: 0 } : s)),
      }));
      const unit = g.venue === "demo" ? `$${Math.abs(profit).toFixed(2)}` : `${Math.abs(profit).toFixed(4)} SOL`;
      pushToast({ kind: "exit", tone: profit >= 0 ? "good" : "bad", title: `Grid sold a level on ${g.symbol || "coin"} · ${g.venue}`, body: `${profit >= 0 ? "+" : "−"}${unit} on this swing`, href: tokenHref(g.mint) });
    }
  } catch (e) {
    const msg = tradeErrorText(e);
    // The slot goes back to what it was; the grid tries again on the next pass.
    updateGrid(g.id, { busy: false, note: msg, slots: g.slots });
  }
}

/** Mounted once in the app shell: runs this browser's grids while Kixo is open. A grid
 *  only trades on the venue it was made on (a demo grid waits while in real mode). */
export function GridEngine() {
  const grids = useGrids();
  const { venue } = useVenue();
  const { solUsd } = useRadarFeed();
  const { account } = useDemo();
  const ctx = useRef<Ctx>({ venue, solUsd, demoHeld: () => 0 });
  useEffect(() => {
    ctx.current = { venue, solUsd, demoHeld: (mint) => account?.positions.find((p) => p.mint === mint)?.tokens ?? 0 };
  }, [venue, solUsd, account]);
  const active = grids.some((g) => g.status === "running");

  useEffect(() => {
    if (!active) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const running = getGrids().filter((g) => g.status === "running" && !g.busy && g.venue === ctx.current.venue);
        if (!running.length) return;
        const prices = await fetchPrices([...new Set(running.map((g) => g.mint))]);
        for (const g of running) {
          const p = prices[g.mint];
          if (p != null) await stepGrid(g, p, ctx.current);
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
