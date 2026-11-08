"use client";

/** Streamer mode: blurs balances, P&L and the user's own wallet address everywhere, so
 *  people can record or stream Kixo without showing what they hold. A per-browser
 *  preference; anything marked `data-private` is blurred (globals.css). */

import { useEffect, useSyncExternalStore } from "react";

const KEY = "kixo.streamer";
let on = false;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    on = localStorage.getItem(KEY) === "1";
  } catch {}
}

export function setStreamer(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
  subs.forEach((f) => f());
}

export function useStreamer(): boolean {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => (load(), on),
    () => false,
  );
}

/** Mounted once: applies the mode to the page and toggles it with Shift+S. */
export function useStreamerMode() {
  const v = useStreamer();
  useEffect(() => {
    document.documentElement.dataset.streamer = v ? "1" : "0";
  }, [v]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']");
      if (!typing && e.shiftKey && (e.key === "S" || e.key === "s") && !e.metaKey && !e.ctrlKey && !e.altKey) setStreamer(!on);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}
