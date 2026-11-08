"use client";

import { useEffect, useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";
import { accessToken, currentUserId, useAccount } from "./account";

/* The user's settings, kept in their account (gateway settings.rs) so they follow them
   to every device. A copy is cached per user in the browser so pages open with them at
   once; the gateway's copy wins when it arrives. */

export type Settings = {
  trading: { slippage_bps: number; speed: "fast" | "turbo"; mev: boolean; buy_presets: number[]; sell_presets: number[]; confirm_above_sol: number; quick_buy_sol: number };
  demo: { buy_presets_usd: number[]; quick_buy_usd: number };
  notifications: { trades: boolean; exits: boolean; sniper: boolean; sound: boolean };
  general: { start_mode: "last" | "demo" | "real" };
};

export const DEFAULTS: Settings = {
  trading: { slippage_bps: 1000, speed: "turbo", mev: true, buy_presets: [0.05, 0.1, 0.25, 0.5, 1], sell_presets: [25, 50, 75, 100], confirm_above_sol: 1, quick_buy_sol: 0.1 },
  demo: { buy_presets_usd: [10, 50, 100, 500], quick_buy_usd: 25 },
  notifications: { trades: true, exits: true, sniper: true, sound: false },
  general: { start_mode: "last" },
};

export type SaveState = "idle" | "saving" | "saved" | "error";
type Store = { owner: string | null; settings: Settings; loaded: boolean; save: SaveState };

let store: Store = { owner: null, settings: DEFAULTS, loaded: false, save: "idle" };
const listeners = new Set<() => void>();
const set = (s: Partial<Store>) => {
  store = { ...store, ...s };
  listeners.forEach((l) => l());
};
const SERVER: Store = { owner: null, settings: DEFAULTS, loaded: false, save: "idle" };
const cacheKey = (uid: string) => `mx.settings.${uid}`;

function merge(s: Partial<Settings> | null | undefined): Settings {
  return {
    trading: { ...DEFAULTS.trading, ...s?.trading },
    demo: { ...DEFAULTS.demo, ...s?.demo },
    notifications: { ...DEFAULTS.notifications, ...s?.notifications },
    general: { ...DEFAULTS.general, ...s?.general },
  };
}

/** The current settings outside React (toasts, sounds). Defaults when signed out. */
export function getSettings(): Settings {
  return store.owner && store.owner === currentUserId() ? store.settings : DEFAULTS;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = accessToken();
  if (!token) throw new Error("Sign in first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

let loading: string | null = null;
let startApplied = false;
/** Loads the signed-in user's settings: the cached copy at once, the account's after. */
async function load(uid: string, onStart?: (mode: "demo" | "real") => void) {
  if (loading === uid || (store.owner === uid && store.loaded)) return;
  loading = uid;
  try {
    const cached = localStorage.getItem(cacheKey(uid));
    set({ owner: uid, settings: merge(cached ? JSON.parse(cached) : null), loaded: false });
  } catch {
    set({ owner: uid, settings: DEFAULTS, loaded: false });
  }
  try {
    const s = merge(await call<Settings>("GET", "/account/settings"));
    if (currentUserId() !== uid) return;
    set({ settings: s, loaded: true });
    try {
      localStorage.setItem(cacheKey(uid), JSON.stringify(s));
    } catch {}
    // Start mode applies once per visit, right after signing in.
    if (!startApplied && onStart && s.general.start_mode !== "last") {
      startApplied = true;
      onStart(s.general.start_mode);
    }
  } catch {
    set({ loaded: true });
  } finally {
    loading = null;
  }
}

/** The signed-in user's settings, loading them on first use. */
export function useSettings(onStart?: (mode: "demo" | "real") => void) {
  const s = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => store,
    () => SERVER,
  );
  const account = useAccount();
  const uid = account.status === "signed-in" ? (account.me?.id ?? currentUserId()) : null;
  useEffect(() => {
    if (uid) load(uid, onStart);
  }, [uid, onStart]);
  const mine = uid !== null && s.owner === uid;
  return { settings: mine ? s.settings : DEFAULTS, loaded: mine && s.loaded, save: s.save };
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Changes settings at once in the page and saves them to the account shortly after. */
export function updateSettings(patch: (s: Settings) => Settings) {
  const uid = currentUserId();
  if (!uid || store.owner !== uid) return;
  const next = patch(store.settings);
  set({ settings: next, save: "saving" });
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify(next));
  } catch {}
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const saved = merge(await call<Settings>("PUT", "/account/settings", next));
      if (currentUserId() !== uid) return;
      // The gateway clamps values; show what it stored.
      set({ settings: saved, save: "saved" });
      try {
        localStorage.setItem(cacheKey(uid), JSON.stringify(saved));
      } catch {}
    } catch {
      set({ save: "error" });
    }
  }, 600);
}

/** Downloads everything Kixo stores about the user as a JSON file. */
export async function downloadMyData() {
  const data = await call<unknown>("GET", "/account/export");
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `monexa-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export const deleteMyAccount = () => call<{ ok: boolean }>("POST", "/account/delete", { confirm: "DELETE" });

/** A short tone for trade and exit pop-ups, when the user turned sounds on. */
export function playTone(good: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = good ? 880 : 330;
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
    o.onended = () => ctx.close();
  } catch {}
}
