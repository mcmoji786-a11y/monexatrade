"use client";

import { useEffect, useSyncExternalStore } from "react";
import { GATEWAY_WS } from "./gateway";

/* Kixo News: one live connection per tab to the gateway's news feed (gateway news.rs),
   shared by the side panel and the /news page. The panel's open state is remembered in
   this browser (a convenience only). */

export type NewsKind = "news" | "community" | "x" | "onchain" | "video";
export type NewsItem = {
  id: string;
  kind: NewsKind;
  source: string;
  title: string;
  summary: string | null;
  /** The original article, or a Kixo page (/token/...) for on-chain events. */
  url: string;
  ts: number;
  tags: ("solana" | "memecoin")[];
  mint: string | null;
  /** A picture from the source (shown through the gateway's image proxy). */
  image: string | null;
  /** A YouTube video id, played inside the panel. */
  video: string | null;
  /** Established coins the story names. */
  coins: { mint: string; symbol: string }[];
  /** On-chain alerts from Kixo's engine. */
  alert: "rising" | "million" | "graduated" | "whale" | "dev_out" | "pump" | "trending" | "sniped" | null;
  /** The coin's own X (Twitter) link. */
  x_url: string | null;
};

type State = { items: NewsItem[]; status: "connecting" | "live" | "offline"; open: boolean; unread: number; seenTs: number };
const OPEN_KEY = "mx.news.open";
const MAX = 300;

let state: State = { items: [], status: "connecting", open: false, unread: 0, seenTs: 0 };
let loaded = false;
const listeners = new Set<() => void>();
const SERVER: State = { items: [], status: "connecting", open: false, unread: 0, seenTs: 0 };

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    state = { ...state, open: localStorage.getItem(OPEN_KEY) === "1" };
  } catch {}
}

/* ---- the connection ---- */
let sock: WebSocket | null = null;
let users = 0;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function merge(incoming: NewsItem[], replace: boolean) {
  const byId = new Map((replace ? [] : state.items).map((i) => [i.id, i]));
  for (const i of incoming) byId.set(i.id, i);
  const items = [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX);
  // New stories while the panel is closed count as unread.
  const unread = state.open ? 0 : items.filter((i) => i.ts > state.seenTs).length;
  set({ items, unread: state.seenTs ? unread : 0, seenTs: state.seenTs || (state.open ? Date.now() / 1000 : items[0]?.ts ?? 0) });
}

function connect() {
  if (sock) return;
  const ws = new WebSocket(`${GATEWAY_WS}/ws/news`);
  sock = ws;
  ws.onopen = () => {
    retry = 0;
    set({ status: "live" });
  };
  ws.onmessage = (m) => {
    try {
      const v = JSON.parse(String(m.data)) as { type: string; items: NewsItem[] };
      merge(v.items ?? [], v.type === "snapshot");
    } catch {}
  };
  ws.onclose = () => {
    if (sock === ws) sock = null;
    set({ status: "offline" });
    if (users > 0) timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry++));
  };
}

/** The live feed. Keeps the connection open while any component uses it. */
export function useNews(on = true) {
  const s = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (load(), state),
    () => SERVER,
  );
  useEffect(() => {
    if (!on) return;
    users++;
    connect();
    return () => {
      users--;
      if (users === 0) {
        clearTimeout(timer);
        sock?.close();
        sock = null;
      }
    };
  }, [on]);
  return s;
}

export function setNewsOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {}
  // Opening marks everything as read.
  set(open ? { open, unread: 0, seenTs: Date.now() / 1000 } : { open, seenTs: Date.now() / 1000 });
}
export const toggleNews = () => setNewsOpen(!state.open);

export const NEWS_FILTERS: { key: string; label: string; test: (i: NewsItem) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "movers", label: "Movers", test: (i) => i.alert === "pump" || i.alert === "trending" || i.alert === "whale" },
  { key: "new", label: "New coins", test: (i) => i.alert === "rising" || i.alert === "million" || i.alert === "graduated" || i.alert === "sniped" },
  { key: "solana", label: "Solana", test: (i) => i.tags.includes("solana") },
  { key: "memecoin", label: "Memecoins", test: (i) => i.tags.includes("memecoin") },
  { key: "coins", label: "Coins", test: (i) => i.coins.length > 0 },
  { key: "video", label: "Videos", test: (i) => i.kind === "video" },
  { key: "onchain", label: "On-chain", test: (i) => i.kind === "onchain" },
  { key: "community", label: "Community", test: (i) => i.kind === "community" || i.kind === "x" },
];

/** Whether a story matches a search: every word must appear in its headline, intro,
 *  source or coins ("$bonk" and "bonk" both find BONK). */
export function newsMatches(i: NewsItem, query: string) {
  const words = query.toLowerCase().replace(/\$/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${i.title} ${i.summary ?? ""} ${i.source} ${i.coins.map((c) => c.symbol).join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function newsAgo(ts: number, nowMs: number) {
  const s = Math.max(0, nowMs / 1000 - ts);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
