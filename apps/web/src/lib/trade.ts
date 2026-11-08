"use client";

import { useEffect, useState } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken } from "./account";
import { signTxWithKixo } from "./kixo-wallet";
import { checkTx } from "./tx-check";

/* Real trades: the gateway builds and simulates, the browser checks, the Kixo wallet signs
   (in the browser, no popup), the gateway sends and tracks. The key never leaves the browser. */

export type TradeConfig = {
  enabled: boolean;
  ready: boolean;
  /** Why real trading is not ready, when it is not. */
  not_ready?: string | null;
  fee_bps: number;
  max_lamports: number;
  min_lamports: number;
  fee_wallet: string | null;
  tip_accounts: string[];
  speeds: Record<"fast" | "turbo", { tip: number; max_priority: number }>;
  allowlist: boolean;
};

export type Quote = {
  /** The fee rate this user pays, after any promo code (basis points). */
  fee_bps?: number;
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

/** The real-trading config, fetched once and reused for a minute (for the sniper). */
let cfgAt = 0;
export async function tradeConfig(): Promise<TradeConfig> {
  if (cfgCache && Date.now() - cfgAt < 60_000) return cfgCache;
  cfgCache = await call<TradeConfig>("/trade/config");
  cfgAt = Date.now();
  return cfgCache;
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

/** Checks the quoted transaction, signs it with the unlocked Kixo wallet (no popup) and
 *  sends it. Returns the signature. */
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
    signed = await signTxWithKixo(tx);
  } catch (e) {
    throw new TradeFail({ code: "wallet", message: e instanceof Error ? e.message : String(e), hint: "Nothing was sent" });
  }
  onStage("sending");
  const { signature } = await call<{ signature: string }>("/trade/send", { build_id: q.build_id, tx: toB64(signed) });
  onStage("confirming");
  return signature;
}

/** How a real trade was sent and how fast it landed (from the gateway, never estimated). */
export type TradeReceipt = {
  sent_slot?: number | null;
  landed_slot?: number | null;
  /** Slots between sending and landing. */
  slots?: number | null;
  direct_resends?: number;
  /** Kixo's own time, from the signed trade reaching Kixo to the first copy on the network (microseconds). */
  kixo_us?: number | null;
  paths?: {
    kixo_direct?: { leaders: number; reached: number; warm: number; ms: number } | null;
    helius_sender?: boolean;
    jito?: boolean;
    rpc?: boolean;
  };
};

export type TradeStatus = { signature: string; status: "sent" | "confirmed" | "failed" | "expired"; error?: TradeError | null; latency_ms?: number | null; receipt?: TradeReceipt | null };

/** One plain line about how the trade got in, e.g. "Landed 2 slots after sending · sent straight to 4 validators". */
export function receiptLine(r: TradeReceipt | null | undefined): string | null {
  if (!r) return null;
  const parts: string[] = [];
  if (typeof r.slots === "number") parts.push(r.slots <= 1 ? "Landed in the next slot" : `Landed ${r.slots} slots after sending`);
  const d = r.paths?.kixo_direct;
  if (d && d.reached > 0) parts.push(`sent straight to ${d.reached} validator${d.reached === 1 ? "" : "s"}${d.warm > 0 ? " on open connections" : ""}`);
  const others = [r.paths?.helius_sender && "Helius Sender", r.paths?.jito && "Jito", r.paths?.rpc && "RPC"].filter(Boolean);
  if (others.length) parts.push(`plus ${others.join(", ")}`);
  if (typeof r.kixo_us === "number") parts.push(`Kixo time ${r.kixo_us < 1000 ? `${(r.kixo_us / 1000).toFixed(2)} ms` : `${Math.round(r.kixo_us / 1000)} ms`}`);
  if (!parts.length) return null;
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
