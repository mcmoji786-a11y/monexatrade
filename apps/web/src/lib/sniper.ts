"use client";

import { useSyncExternalStore } from "react";
import type { FeedToken } from "./gateway";
import { currentUserId } from "./account";

/* Sniper. It watches every new launch in the live feed, buys the ones that match the
   user's rules at the real on-chain price, and sells on take profit, stop loss or
   time. In demo mode every buy and sell is also an order on the user's demo account
   (sniper-engine.tsx); otherwise it is on paper. No real money: real execution needs
   the founder's approval and a security review. Rules and snipes are kept in this
   browser, separately for each signed-in account. */

export type SniperSettings = {
  enabled: boolean;
  /** Spent per snipe, in SOL or in US dollars (converted at the live SOL price when it buys). */
  buySol: number;
  buyUsd: number;
  buyUnit: "SOL" | "USD";
  /** Only coins at most this old when bought (seconds). */
  maxAgeSecs: number;
  /** Entry filters. null = no limit. */
  minHolders: number | null;
  minTrades: number | null;
  maxDevPct: number | null;
  maxTop10Pct: number | null;
  maxBundlePct: number | null;
  maxEarlyBuyerPct: number | null;
  socialsRequired: boolean;
  skipCopiedSymbols: boolean;
  skipRepeatRuggers: boolean;
  /** Only coins with at least this Safety score (safety.ts), 0 = off. */
  minSafety: number;
  /** Exits. */
  takeProfitPct: number;
  stopLossPct: number;
  /** Trailing stop: sell when the price falls this far from its best since the buy (0 = off). */
  trailingPct: number;
  maxHoldMins: number;
  /** Notifications on every paper buy and sell. */
  notifyToast: boolean;
  notifySound: boolean;
  notifyDesktop: boolean;
  /** Limits. */
  maxOpen: number;
  maxPerHour: number;
  /** Paper costs: price impact plus fees, applied on entry and exit. */
  slippagePct: number;
};

export const DEFAULT_SNIPER: SniperSettings = {
  enabled: false,
  buySol: 0.1,
  buyUsd: 10,
  buyUnit: "SOL",
  maxAgeSecs: 90,
  minHolders: 15,
  minTrades: 20,
  maxDevPct: 5,
  maxTop10Pct: 35,
  maxBundlePct: 20,
  maxEarlyBuyerPct: 15,
  socialsRequired: true,
  skipCopiedSymbols: true,
  skipRepeatRuggers: true,
  minSafety: 55,
  takeProfitPct: 50,
  stopLossPct: 25,
  trailingPct: 0,
  maxHoldMins: 20,
  notifyToast: true,
  notifySound: true,
  notifyDesktop: false,
  maxOpen: 5,
  maxPerHour: 10,
  slippagePct: 3,
};

export type ExitReason = "take profit" | "stop loss" | "trailing stop" | "time" | "manual" | "dropped";
export type SnipePosition = {
  id: string;
  mint: string;
  symbol: string;
  sizeSol: number;
  /** Price per token in SOL, after paper costs. */
  entryPrice: number;
  entryTs: number;
  entryMcSol: number;
  /** Safety score when it was bought. */
  entrySafety?: number;
  /** Best price seen since the buy, for the trailing stop. */
  peakPrice?: number;
  exitPrice?: number;
  exitTs?: number;
  reason?: ExitReason;
};

type State = { settings: SniperSettings; positions: SnipePosition[] };
/** Older versions kept one sniper per browser under this key. */
const OLD_KEY = "mx.sniper";
const MAX_HISTORY = 300;

let state: State = { settings: DEFAULT_SNIPER, positions: [] };
/** Whose sniper is loaded: each account has its own rules and snipes, so one account's
 *  positions never turn into orders on another account's demo balance. */
let loadedFor: string | null | undefined;
const listeners = new Set<() => void>();
const FALLBACK: State = { settings: DEFAULT_SNIPER, positions: [] };
const keyFor = (user: string | null) => `mx.sniper.${user ?? "signed-out"}`;

function load() {
  const user = currentUserId();
  if (loadedFor === user) return;
  loadedFor = user;
  state = { settings: DEFAULT_SNIPER, positions: [] };
  try {
    const raw = localStorage.getItem(keyFor(user));
    if (raw) {
      const s = JSON.parse(raw) as Partial<State>;
      state = { settings: { ...DEFAULT_SNIPER, ...s.settings }, positions: s.positions ?? [] };
    } else if (user) {
      // First visit with per-account storage: keep the rules from the old shared
      // sniper (switched off), never its positions, which may belong to someone else.
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const s = JSON.parse(old) as Partial<State>;
        state = { settings: { ...DEFAULT_SNIPER, ...s.settings, enabled: false }, positions: [] };
        localStorage.setItem(keyFor(user), JSON.stringify(state));
        localStorage.removeItem(OLD_KEY);
      }
    }
  } catch {
    // Storage blocked: defaults for this visit.
  }
}
function set(next: State) {
  state = next;
  try {
    localStorage.setItem(keyFor(loadedFor ?? null), JSON.stringify(next));
  } catch {
    // Not persisted.
  }
  listeners.forEach((l) => l());
}
const get = () => (load(), state);
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function useSniper() {
  const s = useSyncExternalStore(subscribe, get, () => FALLBACK);
  return {
    settings: s.settings,
    positions: s.positions,
    update: (patch: Partial<SniperSettings>) => set({ ...get(), settings: { ...get().settings, ...patch } }),
    reset: () => set({ ...get(), settings: { ...DEFAULT_SNIPER, enabled: get().settings.enabled } }),
    close: (id: string, price: number) => set({ ...get(), positions: closeIn(get().positions, id, price, "manual") }),
    clearHistory: () => set({ ...get(), positions: get().positions.filter((p) => !p.exitTs) }),
  };
}

function closeIn(list: SnipePosition[], id: string, price: number, reason: ExitReason) {
  const cost = 1 - get().settings.slippagePct / 100;
  return list.map((p) => (p.id === id && !p.exitTs ? { ...p, exitPrice: price * cost, exitTs: Math.floor(Date.now() / 1000), reason } : p));
}

/** Removes a position the demo account could not fill (for example, not enough balance). */
export function dropPosition(id: string) {
  set({ ...get(), positions: get().positions.filter((p) => p.id !== id) });
}

/** Profit in SOL and % for a position at `price` (exit price if closed). */
export function pnl(p: SnipePosition, price: number | null) {
  const exit = p.exitPrice ?? (price != null ? price * (1 - get().settings.slippagePct / 100) : null);
  if (exit == null || !p.entryPrice) return { sol: null as number | null, pct: null as number | null };
  const pct = (exit / p.entryPrice - 1) * 100;
  return { sol: (p.sizeSol * pct) / 100, pct };
}

/** Why a coin is (not) a snipe under the settings; empty means buy. */
export function entryBlocks(t: FeedToken, s: SniperSettings, nowSecs: number, copied: boolean): string[] {
  const m = t.market;
  const out: string[] = [];
  if (!m || !m.sol_quoted || !m.price_sol) return ["no SOL price yet"];
  if (m.complete) out.push("already graduated");
  if (nowSecs - t.timestamp > s.maxAgeSecs) out.push("too old");
  if (s.minHolders != null && m.holders < s.minHolders) out.push("few holders");
  if (s.minTrades != null && m.trades_total < s.minTrades) out.push("few trades");
  if (s.maxDevPct != null && m.dev_pct > s.maxDevPct) out.push("dev holds too much");
  if (m.dev_sold_all || m.dev_sells > 0) out.push("dev selling");
  if (s.maxTop10Pct != null && m.top10_pct > s.maxTop10Pct) out.push("top 10 too high");
  if (s.maxBundlePct != null && m.bundle_pct > s.maxBundlePct) out.push("bundled");
  if (s.maxEarlyBuyerPct != null && m.sniper_pct > s.maxEarlyBuyerPct) out.push("early buyers too high");
  if (s.socialsRequired && !(t.meta && (t.meta.twitter || t.meta.telegram || t.meta.website))) out.push("no socials");
  if (s.skipCopiedSymbols && copied) out.push("copied symbol");
  if (s.skipRepeatRuggers && t.dev_report && t.dev_report.rugged > 0) out.push("dev rugged before");
  return out;
}

/** Ready-made rule sets: quick to apply from the radar button. */
export const PRESETS: { key: string; label: string; hint: string; patch: Partial<SniperSettings> }[] = [
  {
    key: "safe",
    label: "Safe",
    hint: "Strict filters, small wins, tight stop",
    patch: { minSafety: 70, maxAgeSecs: 300, minHolders: 40, minTrades: 40, maxDevPct: 3, maxTop10Pct: 25, maxBundlePct: 10, maxEarlyBuyerPct: 8, socialsRequired: true, skipCopiedSymbols: true, skipRepeatRuggers: true, takeProfitPct: 30, stopLossPct: 15, trailingPct: 10, maxHoldMins: 15, maxOpen: 3, maxPerHour: 6 },
  },
  {
    key: "balanced",
    label: "Balanced",
    hint: "The default mix",
    patch: { minSafety: 55, maxAgeSecs: 90, minHolders: 15, minTrades: 20, maxDevPct: 5, maxTop10Pct: 35, maxBundlePct: 20, maxEarlyBuyerPct: 15, socialsRequired: true, skipCopiedSymbols: true, skipRepeatRuggers: true, takeProfitPct: 50, stopLossPct: 25, trailingPct: 0, maxHoldMins: 20, maxOpen: 5, maxPerHour: 10 },
  },
  {
    key: "aggressive",
    label: "Aggressive",
    hint: "Earlier entries, bigger targets, more risk",
    patch: { minSafety: 40, maxAgeSecs: 45, minHolders: 8, minTrades: 10, maxDevPct: 10, maxTop10Pct: 50, maxBundlePct: 35, maxEarlyBuyerPct: 25, socialsRequired: false, skipCopiedSymbols: false, skipRepeatRuggers: true, takeProfitPct: 100, stopLossPct: 35, trailingPct: 20, maxHoldMins: 30, maxOpen: 8, maxPerHour: 20 },
  },
];

export function activePreset(s: SniperSettings) {
  return PRESETS.find((p) => Object.entries(p.patch).every(([k, v]) => s[k as keyof SniperSettings] === v))?.key ?? null;
}

export type SniperEvent = { kind: "buy" | "sell"; position: SnipePosition };

/* What the sniper looked at recently: every launch it checked while the launch was young
   enough for the rules, with why it was skipped (empty = bought). Shown on the Sniper
   page so it is clear the sniper is working even when nothing passes. */
const SCAN_WINDOW_SECS = 600;
const scanned = new Map<string, { ts: number; reasons: string[] }>();
let scanView: { checked: number; bought: number; top: [string, number][] } = { checked: 0, bought: 0, top: [] };
const scanListeners = new Set<() => void>();

function publishScan(now: number) {
  for (const [m, v] of scanned) if (now - v.ts > SCAN_WINDOW_SECS) scanned.delete(m);
  const counts = new Map<string, number>();
  let bought = 0;
  for (const v of scanned.values()) {
    if (!v.reasons.length) bought++;
    for (const r of v.reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const next = { checked: scanned.size, bought, top };
  if (JSON.stringify(next) !== JSON.stringify(scanView)) {
    scanView = next;
    scanListeners.forEach((l) => l());
  }
}

/** Launches checked in the last 10 minutes and the most common reasons they were skipped. */
export function useSniperScan() {
  return useSyncExternalStore(
    (l) => (scanListeners.add(l), () => scanListeners.delete(l)),
    () => scanView,
    () => scanView,
  );
}

/** One engine step over the live feed: exits first, then new entries. Returns what
 *  it bought and sold, for notifications. `safetyOf` scores a coin (safety.ts). */
export function sniperStep(tokens: FeedToken[], copied: (t: FeedToken) => boolean, solUsd: number | null, safetyOf: (t: FeedToken) => number): SniperEvent[] {
  const events: SniperEvent[] = [];
  const cur = get();
  const s = cur.settings;
  const now = Math.floor(Date.now() / 1000);
  const byMint = new Map(tokens.map((t) => [t.mint, t]));
  let positions = cur.positions;
  let changed = false;

  // Exits: take profit, stop loss, time, or the coin left the radar (no price to sell at).
  for (const p of positions.filter((x) => !x.exitTs)) {
    const t = byMint.get(p.mint);
    const price = t?.market?.price_sol ?? null;
    if (price == null) {
      if (now - p.entryTs > 60) {
        positions = closeIn(positions, p.id, p.entryPrice * 0.05, "dropped");
        events.push({ kind: "sell", position: positions.find((x) => x.id === p.id)! });
        changed = true;
      }
      continue;
    }
    const move = (price / p.entryPrice - 1) * 100;
    const peak = Math.max(p.peakPrice ?? p.entryPrice, price);
    const fromPeak = (price / peak - 1) * 100;
    const reason: ExitReason | null =
      move >= s.takeProfitPct
        ? "take profit"
        : move <= -s.stopLossPct
          ? "stop loss"
          : s.trailingPct > 0 && peak > p.entryPrice && fromPeak <= -s.trailingPct
            ? "trailing stop"
            : now - p.entryTs >= s.maxHoldMins * 60
              ? "time"
              : null;
    if (reason) {
      positions = closeIn(positions, p.id, price, reason);
      events.push({ kind: "sell", position: positions.find((x) => x.id === p.id)! });
      changed = true;
    } else if (peak !== p.peakPrice) {
      positions = positions.map((x) => (x.id === p.id ? { ...x, peakPrice: peak } : x));
      changed = true;
    }
  }

  // A dollar amount needs the live SOL price to know how much SOL to spend.
  const size = s.buyUnit === "USD" ? (solUsd ? s.buyUsd / solUsd : 0) : s.buySol;
  if (s.enabled && size > 0) {
    const open = positions.filter((x) => !x.exitTs).length;
    const lastHour = positions.filter((x) => now - x.entryTs < 3600).length;
    const held = new Set(positions.map((x) => x.mint));
    let room = Math.min(s.maxOpen - open, s.maxPerHour - lastHour);
    for (const t of tokens) {
      if (held.has(t.mint)) continue;
      const blocks = entryBlocks(t, s, now, copied(t));
      // Only launches still young enough for the rules, with a price, count as checked.
      const young = !blocks.includes("too old") && !blocks.includes("no SOL price yet");
      if (blocks.length) {
        if (young) scanned.set(t.mint, { ts: now, reasons: blocks });
        continue;
      }
      const safety = safetyOf(t);
      if (s.minSafety > 0 && safety < s.minSafety) {
        scanned.set(t.mint, { ts: now, reasons: ["safety score too low"] });
        continue;
      }
      if (room <= 0) {
        scanned.set(t.mint, { ts: now, reasons: ["open or hourly limit reached"] });
        continue;
      }
      scanned.set(t.mint, { ts: now, reasons: [] });
      const m = t.market!;
      positions = [
        {
          entrySafety: safety,
          id: `${t.mint}:${now}`,
          mint: t.mint,
          symbol: t.symbol,
          sizeSol: size,
          entryPrice: m.price_sol * (1 + s.slippagePct / 100),
          entryTs: now,
          entryMcSol: m.mc_sol,
        },
        ...positions,
      ];
      held.add(t.mint);
      events.push({ kind: "buy", position: positions[0] });
      room--;
      changed = true;
    }
  }

  publishScan(now);
  if (changed) set({ ...cur, positions: positions.slice(0, MAX_HISTORY) });
  return events;
}
