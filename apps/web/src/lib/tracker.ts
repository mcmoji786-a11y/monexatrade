"use client";

/** The Wallet Tracker: opens any wallet in a side panel from anywhere on the site, and
 *  remembers the wallets looked at recently (this browser only). */

import { useEffect, useState, useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";

export type AddressKind = { kind: "wallet" | "coin" | "token_account" | "program"; symbol?: string; name?: string; image?: string | null; mc_usd?: number | null };

/** What a pasted address is (a coin's address is not a wallet). Null while checking, or
 *  when the check fails, in which case it is shown as a wallet. */
export function useAddressKind(address: string): AddressKind | null | "checking" {
  const [state, setState] = useState<{ address: string; v: AddressKind | null } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${GATEWAY_HTTP}/address/${address}/kind`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: AddressKind | null) => live && setState({ address, v }))
      .catch(() => live && setState({ address, v: null }));
    return () => {
      live = false;
    };
  }, [address]);
  return state?.address === address ? state.v : "checking";
}

const RECENT_KEY = "kixo.tracker.recent";
const MAX_RECENT = 12;

let open: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const isWallet = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());

/** Opens the tracker panel on `address`. */
export function openWalletTracker(address: string) {
  if (!isWallet(address)) return;
  open = address.trim();
  remember(open);
  emit();
}

export function closeWalletTracker() {
  open = null;
  emit();
}

export function useOpenWallet(): string | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => open,
    () => null,
  );
}

/* ---------------- Recently viewed ---------------- */

let recentCache: string[] | null = null;

function readRecent(): string[] {
  if (recentCache) return recentCache;
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    recentCache = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && isWallet(x)).slice(0, MAX_RECENT) : [];
  } catch {
    recentCache = [];
  }
  return recentCache;
}

export function remember(address: string) {
  const next = [address, ...readRecent().filter((a) => a !== address)].slice(0, MAX_RECENT);
  recentCache = next;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  emit();
}

export function forgetRecent() {
  recentCache = [];
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {}
  emit();
}

const EMPTY: string[] = [];
export function useRecentWallets(): string[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    readRecent,
    () => EMPTY,
  );
}
