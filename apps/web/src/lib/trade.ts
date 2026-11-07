"use client";

import { useEffect, useState } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken } from "./account";
import { signTransactionWithPhantom } from "./phantom";
import { checkTx } from "./tx-check";

/* Real trades: the gateway builds and simulates, the browser checks, Phantom signs, the
   gateway sends and tracks. Keys never leave Phantom. */

export type TradeConfig = {
  enabled: boolean;
  ready: boolean;
  fee_bps: number;
  max_lamports: number;
  min_lamports: number;
  fee_wallet: string | null;
  tip_accounts: string[];
  speeds: Record<"fast" | "turbo", { tip: number; max_priority: number }>;
  allowlist: boolean;
};

export type Quote = {
  build_id: string;
  tx: string;
  expires_in: number;
  side: "buy" | "sell";
  decimals: number;
  sol_lamports: string;
  token_amount: string;
  min_out: string;
  price_impact_pct: number | null;
  platform_fee_lamports: number;
  priority_fee_lamports: number;
  tip_lamports: number;
  network_fee_lamports: number;
  slippage_bps: number;
  speed: "fast" | "turbo";
  mev: boolean;
  route: string[];
};

export type TradeError = { code: string; message: string; hint?: string; logs?: string[] };
export class TradeFail extends Error {
  constructor(public info: TradeError) {
    super(info.message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = accessToken();
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let v: unknown = null;
  try {
    v = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const e = (v ?? {}) as Partial<TradeError>;
    throw new TradeFail({ code: e.code ?? "error", message: e.message ?? (text.slice(0, 160) || `Request failed (${res.status})`), hint: e.hint, logs: e.logs });
  }
  return v as T;
}

let cfgCache: TradeConfig | null = null;
export function useTradeConfig() {
  const [cfg, setCfg] = useState<TradeConfig | null>(cfgCache);
  useEffect(() => {
    let alive = true;
    const load = () =>
      call<TradeConfig>("/trade/config")
        .then((c) => {
          cfgCache = c;
          if (alive) setCfg(c);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return cfg;
}

export type QuoteIn = { wallet: string; mint: string; side: "buy" | "sell"; lamports?: number; fraction?: number; slippage_bps: number; speed: "fast" | "turbo"; mev: boolean; symbol?: string };

export const getQuote = (q: QuoteIn) => call<Quote>("/trade/quote", q);

/** While a real ticket is open, tells the gateway to keep the blockhash, fees and
 *  connections warm, so pressing Buy or Sell does not wait for them. */
export function usePrepare(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const ping = () => document.visibilityState === "visible" && call("/trade/prepare", {}).catch(() => {});
    ping();
    const t = setInterval(ping, 30_000);
    return () => clearInterval(t);
  }, [on]);
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(""));

export type Stage = "checking" | "signing" | "sending" | "confirming";

/** Checks the quoted transaction, has Phantom sign it, sends it. Returns the signature. */
export async function signAndSend(q: Quote, wallet: string, cfg: TradeConfig, onStage: (s: Stage) => void) {
  onStage("checking");
  const tx = b64(q.tx);
  checkTx(tx, {
    wallet,
    side: q.side,
    spendLamports: q.side === "buy" ? BigInt(q.sol_lamports) : BigInt(0),
    feeWallet: cfg.fee_wallet ?? "",
    feeLamports: BigInt(q.platform_fee_lamports),
    tipAccounts: cfg.tip_accounts,
    tipLamports: BigInt(q.tip_lamports),
    priorityLamports: BigInt(q.priority_fee_lamports),
  });
  onStage("signing");
  let signed: Uint8Array;
  try {
    signed = await signTransactionWithPhantom(tx, wallet);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/reject|denied|cancel/i.test(m)) throw new TradeFail({ code: "rejected", message: "You cancelled in Phantom", hint: "Nothing was sent" });
    throw new TradeFail({ code: "wallet", message: m });
  }
  onStage("sending");
  const { signature } = await call<{ signature: string }>("/trade/send", { build_id: q.build_id, tx: toB64(signed) });
  onStage("confirming");
  return signature;
}

export type TradeStatus = { signature: string; status: "sent" | "confirmed" | "failed" | "expired"; error?: TradeError | null; latency_ms?: number | null };

/** Waits for the gateway to see the trade land, fail or expire (about 90 s at most). */
export async function waitForTrade(signature: string): Promise<TradeStatus> {
  const started = Date.now();
  while (Date.now() - started < 95_000) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const s = await call<TradeStatus>(`/trade/status/${signature}`);
      if (s.status !== "sent") return s;
    } catch {}
  }
  return { signature, status: "sent" };
}

export const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;
export const sol = (lamports: number | string | bigint) => Number(lamports) / 1e9;
