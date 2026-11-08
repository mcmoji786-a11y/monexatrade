"use client";

/** Platform settings the founder changes in the admin (fees, limits, Lower risk rules),
 *  read once per visit and refreshed every 5 minutes. */

import { useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { NEW_LAUNCH } from "./risk";

export type Platform = {
  trade_fee_bps: number;
  deposit_fee_bps: number;
  withdraw_fee_bps: number;
  max_trade_sol: number;
  min_deposit_sol: number;
  max_deposit_sol: number;
  lower_risk_min_safety: number;
  lower_risk_hold_secs: number;
};

export const PLATFORM_DEFAULTS: Platform = {
  trade_fee_bps: 50,
  deposit_fee_bps: 0,
  withdraw_fee_bps: 50,
  max_trade_sol: 3,
  min_deposit_sol: 0.001,
  max_deposit_sol: 100,
  lower_risk_min_safety: 80,
  lower_risk_hold_secs: 180,
};

let state: Platform = PLATFORM_DEFAULTS;
let started = false;
const subs = new Set<() => void>();

async function load() {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/platform`, { cache: "no-store" });
    if (!r.ok) return;
    state = { ...PLATFORM_DEFAULTS, ...((await r.json()) as Partial<Platform>) };
    // Sol Radar's Lower risk tab reads these rules.
    NEW_LAUNCH.minSafety = state.lower_risk_min_safety;
    NEW_LAUNCH.holdSecs = state.lower_risk_hold_secs;
    subs.forEach((f) => f());
  } catch {}
}

export function usePlatform(): Platform {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!started) {
        started = true;
        void load();
        setInterval(() => void load(), 5 * 60_000);
      }
      return () => subs.delete(f);
    },
    () => state,
    () => PLATFORM_DEFAULTS,
  );
}

/** "0.5%" from basis points. */
export const pctOf = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
