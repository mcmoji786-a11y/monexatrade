"use client";

import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { GATEWAY_HTTP } from "./gateway";
import { supabase } from "./supabase";
import { phantom } from "./phantom";
import { pushToast } from "./toast";

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
  /** Accepted the current privacy and risk terms (kept on the Supabase user). */
  accepted: boolean;
  /** Wallet connected in Phantom for this visit only (Google and email accounts). Never saved. */
  connected: string | null;
};

/** Bump when the terms change; everyone accepts the new version once. */
export const TERMS_VERSION = 1;

const CACHE = "mx.me";
let state: Account = { status: "loading", me: null, error: null, accepted: true, connected: null };
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
  const forUser = session?.user.id;
  try {
    const me = await api<Me>("/account/sync", {});
    if (session?.user.id !== forUser) return; // signed out or switched meanwhile
    remember(me);
    set({ status: "signed-in", me, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load your account";
    if (/linked to another account/i.test(msg)) {
      // A Phantom sign-in with a wallet that already belongs to a Google or email account:
      // do not leave a second, empty account signed in.
      await signOut();
      pushToast({ tone: "bad", title: "This wallet already has an account", body: "Sign in with the Google or email account it is linked to" });
      return;
    }
    set({ status: "signed-in", error: msg });
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
    if (s) {
      // Never show another account's cached profile.
      const sameUser = state.me?.id === s.user.id;
      if (!sameUser) remember(null);
      set({ status: "signed-in", me: sameUser ? state.me : null, connected: sameUser ? state.connected : null, accepted: Number(s.user.user_metadata?.terms_version ?? 0) >= TERMS_VERSION });
    }
    if (!s) {
      remember(null);
      set({ status: "signed-out", me: null, error: null, connected: null });
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

const SERVER: Account = { status: "loading", me: null, error: null, accepted: true, connected: null };

export function useAccount(): Account {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

/** Records that the user accepted the terms, with the time, on their Supabase account. */
export async function acceptTerms() {
  const { error } = await client().auth.updateUser({ data: { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() } });
  if (error) throw error;
  set({ accepted: true });
}

/** The current access token, for calls to the gateway. */
export const accessToken = () => session?.access_token ?? null;
/** The signed-in user's id, or null when signed out. */
export const currentUserId = () => session?.user?.id ?? null;

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

/** Sign in with Solana (Phantom). Supabase checks the signature; the wallet is the account.
 *  Phantom is connected first and handed over as a plain signer, so the message format is
 *  always the standard one Supabase verifies (Phantom's own signIn output varies by version). */
export async function signInWithPhantom() {
  const p = phantom();
  if (!p) throw new Error("Phantom is not installed");
  const { publicKey } = await p.connect();
  const address = publicKey.toString();
  const signer = {
    publicKey: { toBase58: () => address },
    signMessage: async (msg: Uint8Array) => {
      const out = await p.signMessage(msg, "utf8");
      const sig = (out as { signature?: Uint8Array }).signature ?? (out as unknown as Uint8Array);
      return new Uint8Array(sig);
    },
  };
  const { error } = await client().auth.signInWithWeb3({
    chain: "solana",
    statement: "Sign in to Kixo. This does not move funds or cost anything.",
    wallet: signer as never,
  });
  if (error) throw error;
}

/** Signs out on every device and browser (all sessions of this account). */
export async function signOutEverywhere() {
  try {
    await supabase()?.auth.signOut({ scope: "global" });
  } catch {}
  await signOut();
}

export async function signOut() {
  remember(null);
  set({ status: "signed-out", me: null, error: null, connected: null });
  try {
    await supabase()?.auth.signOut();
  } catch {}
  try {
    await phantom()?.disconnect?.();
  } catch {}
}

/** The wallet to show: a Phantom account's own wallet, otherwise the one connected now. */
export const activeWallet = (a: Account) => (a.me?.login_method === "phantom" ? a.me.wallet : a.connected);

/** Google and email accounts: connect Phantom for this visit. Phantom asks permission;
 *  nothing is signed or saved, and it is forgotten on sign-out or reload. */
export async function connectWallet() {
  const p = phantom();
  if (!p) throw new Error("Phantom is not installed");
  const { publicKey } = await p.connect();
  const wallet = publicKey.toString();
  set({ connected: wallet });
  return wallet;
}

export async function disconnectWallet() {
  set({ connected: null });
  try {
    await phantom()?.disconnect?.();
  } catch {}
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

/* ---------------- Login popup ---------------- */

let popup: string | null = null;
const popupListeners = new Set<() => void>();
export function openLogin(next = "/discover") {
  popup = safeNext(next);
  popupListeners.forEach((l) => l());
}
export function closeLogin() {
  popup = null;
  popupListeners.forEach((l) => l());
}
export function useLoginPopup(): string | null {
  return useSyncExternalStore(
    (l) => (popupListeners.add(l), () => popupListeners.delete(l)),
    () => popup,
    () => null,
  );
}
