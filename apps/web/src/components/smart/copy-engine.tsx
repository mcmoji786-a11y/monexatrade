"use client";

import { useEffect, useRef } from "react";
import { execute, tradeErrorText, useVenue, type Venue } from "@/lib/execute";
import { consensusMet, copyCostPct, getCopies, logCopy, mirrorFraction, skipReason, updateCopy, useCopies, type Copy } from "@/lib/copy";
import { useDemo } from "@/lib/demo";
import { useFeatures } from "@/lib/features";
import { GATEWAY_HTTP, GATEWAY_WS, type TradeRow } from "@/lib/gateway";
import { kixoAddress } from "@/lib/kixo-wallet";
import { launchSignals, safetyScore } from "@/lib/safety";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

type Ctx = { venue: Venue | null; solUsd: number | null; safety: (mint: string) => number | null; demoHeld: (mint: string) => number };
type Msg = { type: string; mint: string; symbol: string | null; trade: TradeRow; sol_usd?: number | null };

const DAY = 86_400_000;

async function heldNow(c: Ctx, venue: Venue, mint: string) {
  if (venue === "demo") return c.demoHeld(mint);
  const w = kixoAddress();
  if (!w) return 0;
  const r = await fetch(`${GATEWAY_HTTP}/wallet/${w}/portfolio`, { cache: "no-store" });
  const v = r.ok ? ((await r.json()) as { tokens?: { mint: string; amount: number }[] }) : null;
  return v?.tokens?.find((t) => t.mint === mint)?.amount ?? 0;
}

/** What the leader still holds of a coin after its sell (gateway trade book). */
async function leaderLeft(mint: string, leader: string): Promise<number> {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/token/${mint}/wallets?wallet=${leader}`, { cache: "no-store" });
    const v = r.ok ? ((await r.json()) as { focus?: { balance: number } | null } | null) : null;
    return v?.focus?.balance ?? 0;
  } catch {
    return 0;
  }
}

async function copyBuy(cp: Copy, m: Msg, c: Ctx, recent: Map<string, { leader: string; at: number }[]>) {
  const sym = m.symbol || m.mint.slice(0, 4);
  if (cp.positions[m.mint]) return; // one entry per coin: later buys by the leader add nothing
  const now = Date.now();
  const buys24h = cp.buyTimes.filter((t) => now - t < DAY).length;
  const skip = skipReason(cp.rules, c.safety(m.mint), buys24h) ?? (consensusMet(cp.rules, recent.get(m.mint) ?? [], now) ? null : `Waiting for ${cp.rules.consensus} of your leaders to buy it`);
  if (skip) return logCopy(cp.id, { at: now, side: "buy", mint: m.mint, symbol: sym, result: "skipped", note: skip });
  try {
    const f = await execute(cp.venue, { mint: m.mint, symbol: sym, side: "buy", ...(cp.venue === "demo" ? { usd: cp.rules.amount } : { sol: cp.rules.amount }), solUsd: c.solUsd, source: "copy" });
    const cost = cp.venue === "demo" ? (f.usd ?? cp.rules.amount) : f.sol;
    const leaderUsd = m.sol_usd ? m.trade.price_sol * m.sol_usd : null;
    const costPct = leaderUsd && f.priceUsd ? copyCostPct("buy", leaderUsd, f.priceUsd) : null;
    updateCopy(cp.id, (x) => ({ buys: x.buys + 1, buyTimes: [...x.buyTimes.filter((t) => now - t < DAY), now], positions: { ...x.positions, [m.mint]: { tokens: f.tokens ?? 0, cost, symbol: sym } } }));
    logCopy(cp.id, { at: now, side: "buy", mint: m.mint, symbol: sym, result: "done", costPct });
    pushToast({ kind: "trade", tone: "good", title: `Copied a buy of ${sym} · ${cp.venue}`, body: `${cp.venue === "demo" ? `$${cost.toFixed(2)}` : `${cost.toFixed(4)} SOL`}${costPct != null ? ` · copy cost ${costPct >= 0 ? "+" : "−"}${Math.abs(costPct).toFixed(1)}%` : ""}`, href: tokenHref(m.mint) });
  } catch (e) {
    logCopy(cp.id, { at: now, side: "buy", mint: m.mint, symbol: sym, result: "failed", note: tradeErrorText(e) });
  }
}

async function copySell(cp: Copy, m: Msg, c: Ctx) {
  const pos = cp.positions[m.mint];
  if (!pos || !cp.rules.mirrorSells) return;
  const sym = pos.symbol;
  const now = Date.now();
  try {
    const share = mirrorFraction(m.trade.tokens, await leaderLeft(m.mint, cp.leader));
    const held = await heldNow(c, cp.venue, m.mint);
    if (held <= 0) {
      updateCopy(cp.id, (x) => {
        const { [m.mint]: _gone, ...rest } = x.positions;
        void _gone;
        return { positions: rest };
      });
      return logCopy(cp.id, { at: now, side: "sell", mint: m.mint, symbol: sym, result: "skipped", note: "Already sold outside the copy" });
    }
    const ours = Math.min(pos.tokens, held) * share;
    const f = await execute(cp.venue, { mint: m.mint, symbol: sym, side: "sell", fraction: Math.min(1, ours / held), solUsd: c.solUsd, source: "copy" });
    const got = cp.venue === "demo" ? (f.usd ?? 0) : f.sol;
    const profit = got - pos.cost * share;
    const leaderUsd = m.sol_usd ? m.trade.price_sol * m.sol_usd : null;
    const costPct = leaderUsd && f.priceUsd ? copyCostPct("sell", leaderUsd, f.priceUsd) : null;
    updateCopy(cp.id, (x) => {
      const p = x.positions[m.mint];
      const positions = { ...x.positions };
      if (!p || share >= 0.999) delete positions[m.mint];
      else positions[m.mint] = { ...p, tokens: p.tokens * (1 - share), cost: p.cost * (1 - share) };
      const realized = x.realized + profit;
      // Auto-pause at the loss limit.
      const over = x.rules.maxLoss != null && realized <= -x.rules.maxLoss;
      return { positions, realized, sells: x.sells + 1, ...(over ? { status: "paused" as const, pausedWhy: "Loss limit reached" } : {}) };
    });
    logCopy(cp.id, { at: now, side: "sell", mint: m.mint, symbol: sym, result: "done", costPct, profit });
    const unit = cp.venue === "demo" ? `$${Math.abs(profit).toFixed(2)}` : `${Math.abs(profit).toFixed(4)} SOL`;
    pushToast({ kind: "trade", tone: profit >= 0 ? "good" : "bad", title: `Copied a sell of ${sym} · ${cp.venue}`, figure: `${profit >= 0 ? "+" : "−"}${unit}`, body: `Sold ${Math.round(share * 100)}% like the leader`, href: tokenHref(m.mint) });
  } catch (e) {
    logCopy(cp.id, { at: now, side: "sell", mint: m.mint, symbol: sym, result: "failed", note: tradeErrorText(e) });
  }
}

/** Mounted once in the app shell: listens to the copied wallets' trades and copies them
 *  on the venue each copy belongs to, one at a time, while Kixo is open. */
export function CopyEngine() {
  const on = useFeatures().copy_trading;
  const copies = useCopies();
  const { venue } = useVenue();
  const feed = useRadarFeed();
  const { account } = useDemo();
  const ctx = useRef<Ctx>({ venue, solUsd: null, safety: () => null, demoHeld: () => 0 });
  useEffect(() => {
    const { tokens, markets, smart, solUsd } = feed;
    ctx.current = {
      venue,
      solUsd,
      safety: (mint) => {
        const t = tokens.find((x) => x.mint === mint);
        return t ? safetyScore(launchSignals(t, markets[mint] ?? null, { copyOfReal: false, sameSymbol: false, sameXAccount: false, smart: smart[mint] ?? 0, nowSecs: Date.now() / 1000 })).score : null;
      },
      demoHeld: (mint) => account?.positions.find((p) => p.mint === mint)?.tokens ?? 0,
    };
  }, [venue, feed, account]);
  const leaders = on ? [...new Set(copies.filter((c) => c.status === "running").map((c) => c.leader))].sort().join(",") : "";

  useEffect(() => {
    if (!leaders) return;
    const recent = new Map<string, { leader: string; at: number }[]>();
    let queue: Promise<void> = Promise.resolve();
    const ws = new WebSocket(`${GATEWAY_WS}/ws/wallets?w=${encodeURIComponent(leaders)}`);
    ws.onmessage = (e) => {
      let m: Msg;
      try {
        m = JSON.parse(String(e.data)) as Msg;
      } catch {
        return;
      }
      if (m.type !== "trade" || !m.trade) return;
      if (m.trade.is_buy) {
        const list = (recent.get(m.mint) ?? []).filter((b) => Date.now() - b.at < 60 * 60_000);
        list.push({ leader: m.trade.wallet, at: Date.now() });
        recent.set(m.mint, list);
      }
      queue = queue.then(async () => {
        const c = ctx.current;
        for (const cp of getCopies()) {
          if (cp.status !== "running" || cp.leader !== m.trade.wallet || cp.venue !== c.venue) continue;
          await (m.trade.is_buy ? copyBuy(cp, m, c, recent) : copySell(cp, m, c));
        }
      });
    };
    return () => {
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close();
    };
  }, [leaders]);

  return null;
}
