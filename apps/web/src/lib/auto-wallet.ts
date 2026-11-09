"use client";

/* The auto-trade wallet (gateway auto_wallet.rs): a second wallet whose key Kixo holds so
   automatic trading runs 24/7. Its money can only go back to the main Kixo wallet. */

import { useCallback, useEffect, useState } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken } from "./account";

export type AutoLimits = { max_trade_sol: number; daily_loss_sol: number; min_safety: number; max_slippage_bps: number };
export type AutoWallet = {
  available: boolean;
  exists: boolean;
  pubkey?: string;
  owner?: string;
  lamports?: number | null;
  limits: AutoLimits;
  paused?: boolean;
  max_balance_sol: number;
  over_max?: boolean;
};

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = accessToken();
  if (!token) throw new Error("Sign in first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let v: { message?: string } | null = null;
  try {
    v = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(v?.message ?? `Request failed (${res.status})`);
  return v as T;
}

export const createAutoWallet = () => call<{ pubkey: string }>("/auto-wallet", "POST", {});
export const updateAutoWallet = (patch: { limits?: AutoLimits; paused?: boolean }) => call("/auto-wallet", "PUT", patch);
export const withdrawAutoWallet = (all: boolean, sol?: number) => call<{ signature: string; lamports: number }>("/auto-wallet/withdraw", "POST", all ? { all: true } : { lamports: Math.round((sol ?? 0) * 1e9) });

/** The auto wallet, refreshed every 20 s while shown. */
export function useAutoWallet() {
  const [data, setData] = useState<AutoWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    call<AutoWallet>("/auto-wallet")
      .then((d) => (setData(d), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);
  return { data, error, reload };
}
