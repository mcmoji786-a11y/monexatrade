"use client";
/* Alerts that reach the user when Kixo is closed: Email, Telegram and Discord (gateway
   alerts.rs, migration 0015). Price alerts, Wallet Monitor wallets and starred coins stay
   in this browser's stores (lib/prefs.ts) and are copied to the account, so the gateway
   can watch them. A price alert the gateway already sent disappears here too. */
import { useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken, currentUserId } from "./account";
import { alertInputs, type MonitoredWallet, type PriceAlert } from "./prefs";

export type AlertStatus = { server_delivery: boolean; telegram: boolean; telegram_bot: string | null; email: boolean; discord: boolean };
type ServerPrice = { id: string; mint: string; symbol: string; above: boolean; mc_usd: number };
type ServerWallet = { address: string; label: string; min_buy_sol: number; sells: boolean };
export type RemoteAlerts = {
  saved: boolean;
  account_email: string | null;
  email_on: boolean;
  telegram: boolean;
  discord_webhook: string;
  price: ServerPrice[];
  wallets: ServerWallet[];
  watch: string[];
  dev_sells: boolean;
};

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = accessToken();
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method,
    cache: "no-store",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

export const getStatus = () => call<AlertStatus>("/alerts/status");
export const telegramLink = () => call<{ url: string }>("/alerts/telegram/link", "POST", {});
export const telegramUnlink = () => call<{ ok: boolean }>("/alerts/telegram/unlink", "POST", {});
export const sendTest = () => call<{ sent: Record<string, boolean> }>("/alerts/test", "POST", {});

/* What the account has saved, shared by every component on the page. */
let remote: RemoteAlerts | null = null;
const listeners = new Set<() => void>();
function setRemote(r: RemoteAlerts | null) {
  remote = r;
  listeners.forEach((l) => l());
}
export function useRemoteAlerts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => remote,
    () => null,
  );
}

/* Price alert ids this browser and the account agreed on last time. One missing from
   the account later was sent (or removed elsewhere), so it goes here too. */
const syncedKey = () => `mx.alerts.synced.${currentUserId() ?? "anon"}`;
function readSynced(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(syncedKey()) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSynced(ids: string[]) {
  try {
    localStorage.setItem(syncedKey(), JSON.stringify(ids));
  } catch {
    // Not kept; the next load compares with nothing and keeps every alert.
  }
}

const toServerPrice = (p: PriceAlert): ServerPrice => ({ id: p.id, mint: p.mint, symbol: p.symbol, above: p.above, mc_usd: p.mcUsd });
const fromServerPrice = (p: ServerPrice): PriceAlert => ({ id: p.id, mint: p.mint, symbol: p.symbol, above: p.above, mcUsd: p.mc_usd, created: Date.now() });
const toServerWallet = (w: MonitoredWallet): ServerWallet => ({ address: w.address, label: w.label, min_buy_sol: w.minBuySol, sells: w.sells });
const fromServerWallet = (w: ServerWallet): MonitoredWallet => ({ address: w.address, label: w.label, minBuySol: w.min_buy_sol, sells: w.sells, added: Date.now() });

/** Saves the whole set: this browser's rules plus the channels (changed by `patch`). */
export async function saveAlerts(patch: { email_on?: boolean; discord_webhook?: string } = {}) {
  const local = alertInputs.get();
  const r = await call<RemoteAlerts>("/alerts/me", "PUT", {
    email_on: patch.email_on ?? remote?.email_on ?? false,
    discord_webhook: patch.discord_webhook ?? remote?.discord_webhook ?? "",
    price: local.price.map(toServerPrice),
    wallets: local.wallets.map(toServerWallet),
    watch: local.watch,
    dev_sells: local.devSells,
  });
  setRemote(r);
  writeSynced(r.price.map((p) => p.id));
  return r;
}

/** First load after sign-in: join the account's rules with this browser's, then save. */
export async function firstSync() {
  const r = await call<RemoteAlerts>("/alerts/me");
  setRemote(r);
  const local = alertInputs.get();
  if (r.saved) {
    const synced = readSynced();
    const server = new Set(r.price.map((p) => p.id));
    // Keep local alerts the account never saw; drop ones the account already sent.
    const extra = local.price.filter((p) => !server.has(p.id) && !synced.has(p.id));
    alertInputs.setPrice([...r.price.map(fromServerPrice), ...extra]);
    const known = new Set(r.wallets.map((w) => w.address));
    alertInputs.setWallets([...r.wallets.map(fromServerWallet), ...local.wallets.filter((w) => !known.has(w.address))].slice(0, 50));
    alertInputs.setWatch([...new Set([...local.watch, ...r.watch])].slice(0, 200));
  }
  // A Discord webhook typed in Wallet Monitor before accounts moves to the account.
  const hook = !r.discord_webhook && local.discordWebhook ? local.discordWebhook : undefined;
  return saveAlerts(hook ? { discord_webhook: hook } : {});
}

/** Later loads: only removes price alerts the gateway sent meanwhile. */
export async function pullAlerts() {
  const r = await call<RemoteAlerts>("/alerts/me");
  setRemote(r);
  const synced = readSynced();
  const server = new Set(r.price.map((p) => p.id));
  const local = alertInputs.get().price;
  const keep = local.filter((p) => server.has(p.id) || !synced.has(p.id));
  if (keep.length !== local.length) alertInputs.setPrice(keep);
  writeSynced([...server]);
  return r;
}

export function clearRemote() {
  setRemote(null);
}
