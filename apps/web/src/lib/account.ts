"use client";

import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { GATEWAY_HTTP } from "./gateway";
import { supabase } from "./supabase";
import { phantom, signWithPhantom } from "./phantom";

/* The signed-in account, shared by every component. Supabase holds the session; the
   gateway holds the profile (which wallet the user proved they own). The last profile
   is kept in sessionStorage so pages render signed-in at once while it refreshes. */

export type Me = {
  id: string;
  email: string | null;
  login_method: "google" | "email" | "phantom";
  wallet: string | null;
  wallet_verified: boolean;
};

export type Account = {
  status: "loading" | "signed-out" | "signed-in";
  me: Me | null;
  /** Why the profile could not load (for example the accounts table is not set up). */
  error: string | null;
};

const CACHE = "mx.me";
let state: Account = { status: "loading", me: null, error: null };
let session: Session | null = null;
let started = false;
const listeners = new Set<() => void>();
const set = (s: Partial<Account>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

function cached(): Me | null {
  try {
    const v = sessionStorage.getItem(CACHE);
    return v ? (JSON.parse(v) as Me) : null;
  } catch {
    return null;
  }
}

function remember(me: Me | null) {
  try {
    if (me) sessionStorage.setItem(CACHE, JSON.stringify(me));
    else sessionStorage.removeItem(CACHE);
  } catch {
    // Storage blocked: the profile simply reloads next time.
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  if (!session) throw new Error("Sign in first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: body === undefined && path === "/account/me" ? "GET" : "POST",
    headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

async function sync() {
  try {
    const me = await api<Me>("/account/sync", {});
    remember(me);
    set({ status: "signed-in", me, error: null });
  } catch (e) {
    set({ status: "signed-in", error: e instanceof Error ? e.message : "Could not load your account" });
  }
}

function start() {
  const sb = supabase();
  if (!sb) {
    set({ status: "signed-out", error: "Sign-in is not configured" });
    return;
  }
  const me = cached();
  if (me) set({ status: "signed-in", me });
  sb.auth.onAuthStateChange((event, s) => {
    const changed = s?.access_token !== session?.access_token;
    session = s;
    if (!s) {
      remember(null);
      set({ status: "signed-out", me: null, error: null });
    } else if (changed && event !== "TOKEN_REFRESHED") {
      // Off the auth callback, as Supabase recommends.
      setTimeout(sync, 0);
    }
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!started && typeof window !== "undefined") {
    started = true;
    start();
  }
  return () => listeners.delete(l);
}

const SERVER: Account = { status: "loading", me: null, error: null };

export function useAccount(): Account {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

/** Google and email accounts must prove a wallet before using MONEXA. */
export const needsWallet = (a: Account) => a.status === "signed-in" && !!a.me && !a.me.wallet_verified;

/* ---------------- Sign-in methods ---------------- */

const callback = (next: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;

/** Only same-site paths after sign-in, never another site. */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/discover";
}

function client() {
  const sb = supabase();
  if (!sb) throw new Error("Sign-in is not configured yet");
  return sb;
}

export async function signInWithGoogle(next: string) {
  const { error } = await client().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback(next) } });
  if (error) throw error;
}

export async function sendEmailCode(email: string) {
  const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: callback("/discover") } });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string) {
  const { error } = await client().auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

/** Sign in with Solana (Phantom). Supabase checks the signature; the wallet is the account. */
export async function signInWithPhantom() {
  const wallet = phantom();
  if (!wallet) throw new Error("Phantom is not installed");
  const { error } = await client().auth.signInWithWeb3({
    chain: "solana",
    statement: "Sign in to MONEXA. This does not move funds or cost anything.",
    wallet: wallet as never,
  });
  if (error) throw error;
}

export async function signOut() {
  remember(null);
  await supabase()?.auth.signOut();
  await phantom()?.disconnect?.().catch(() => {});
}

/** Proves a wallet for a Google or email account: sign a one-time message in Phantom. */
export async function linkWallet() {
  const p = phantom();
  if (!p) throw new Error("Phantom is not installed");
  const { publicKey } = await p.connect();
  const wallet = publicKey.toString();
  const { message } = await api<{ message: string }>("/account/link-nonce", { wallet });
  const signed = await signWithPhantom(message, wallet);
  const me = await api<Me>("/account/link-wallet", signed);
  remember(me);
  set({ me, error: null });
  return me;
}

/** Readable text for an auth error. */
export function authError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/user rejected|rejected the request|cancel/i.test(m)) return "Request cancelled in Phantom";
  if (/token has expired|invalid/i.test(m) && /otp|token/i.test(m)) return "That code is wrong or expired";
  if (/rate limit|too many/i.test(m)) return "Too many tries, wait a minute";
  if (/provider is not enabled|unsupported provider/i.test(m)) return "This sign-in method is not switched on yet";
  return m.length > 140 ? "Something went wrong, try again" : m;
}
