"use client";
/* Community (gateway social.rs, migration 0012): trader profiles, follows, the trade feed,
   the leaderboard and a trader's trades for copying. Only demo trades are public, and only
   for traders who made a public profile. */
import { GATEWAY_HTTP } from "./gateway";
import { accessToken } from "./account";

export type TraderProfile = {
  handle: string;
  display_name: string;
  bio: string;
  public: boolean;
  created_at: string;
  /** Pictures and links (migration 0021): empty when not set. */
  avatar_url?: string;
  banner_url?: string;
  x_handle?: string;
  telegram?: string;
  /** Others see this trader's results as percentages only (migration 0022). */
  hide_amounts?: boolean;
};
export type Badge = { key: string; label: string; why: string };
export type DailyPnl = { day: string; realized_usd: number; trades: number; wins: number };
/** Dollar figures are null when the trader hides their amounts. */
export type TraderStats = { realized_usd: number | null; trades: number; win_rate: number; best_usd: number | null; volume_usd: number | null } | null;
export type SocialTrade = {
  id: number;
  handle?: string;
  avatar_url?: string;
  display_name?: string;
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  /** Null when the trader hides their amounts. */
  usd: number | null;
  price_usd: number;
  realized_usd: number | null;
  /** A sale's result against what the sold tokens cost, in %. */
  realized_pct?: number | null;
  remaining?: number | null;
  tokens?: number | null;
  source: string;
  ts: string;
};
export type Trader = {
  profile: TraderProfile;
  own: boolean;
  i_follow: boolean;
  followers: number;
  following: number;
  stats: { d7: TraderStats; d30: TraderStats; all: TraderStats };
  /** Profit taken per day (UTC), last 120 days. */
  daily?: DailyPnl[];
  badges?: Badge[];
  invites?: number;
  /** The viewer sees percentages only. */
  hidden_amounts?: boolean;
  trades: SocialTrade[];
};
/** Dollar figures are null for a trader who hides their amounts. */
export type Leader = { rank: number; handle: string; display_name: string; avatar_url?: string; realized_usd: number | null; trades: number; win_rate: number; best_usd: number | null; followers: number };

async function call<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const token = accessToken();
  if (auth && !token) throw new Error("Sign in first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

export const getMe = () => call<{ profile: TraderProfile | null; followers: number; following: number; following_handles: string[] }>("/social/me", {}, true);
/** An open demo position on a profile: dollar figures are absent when hidden. */
export type ProfilePosition = { mint: string; symbol: string; image: string | null; tokens?: number; cost_usd?: number; value_usd?: number | null; pnl_usd?: number | null; pnl_pct: number | null; opened_at: string };
export type Portfolio = { hidden_amounts: boolean; positions: ProfilePosition[]; best: SocialTrade[]; worst: SocialTrade[]; history: SocialTrade[] };
export const getPortfolio = (handle: string) => call<Portfolio>(`/social/u/${encodeURIComponent(handle)}/portfolio`);
export const saveMe = (p: { handle: string; display_name: string; bio: string; public: boolean; avatar_url?: string; banner_url?: string; x_handle?: string; telegram?: string; hide_amounts?: boolean }) =>
  call<{ profile: TraderProfile }>("/social/me", { method: "PUT", body: JSON.stringify(p) }, true);
export const getTrader = (handle: string) => call<Trader>(`/social/u/${encodeURIComponent(handle)}`);
export const follow = (handle: string, on: boolean) => call<{ following: boolean }>(`/social/follow/${encodeURIComponent(handle)}`, { method: on ? "POST" : "DELETE" }, true);
export const getFeed = (scope: "following" | "everyone", before?: number) =>
  call<{ items: SocialTrade[] }>(`/social/feed?scope=${scope}${before ? `&before=${before}` : ""}`, {}, scope === "following");
export const getLeaders = (period: "7d" | "30d" | "all") => call<{ leaders: Leader[] }>(`/social/leaders?period=${period}`);
/** A trader in a list: to find and follow. */
export type TraderRow = { handle: string; display_name: string; bio: string; created_at: string; avatar_url?: string; followers: number; i_follow: boolean; me: boolean };
export const getTraders = (q: string, sort: "followers" | "new") => call<{ traders: TraderRow[] }>(`/social/traders?q=${encodeURIComponent(q)}&sort=${sort}`);
export const getPeople = (handle: string, who: "followers" | "following") => call<{ people: TraderRow[] }>(`/social/u/${encodeURIComponent(handle)}/people?who=${who}`);
export const getTraderTrades = (handle: string, after: number) => call<{ items: SocialTrade[] }>(`/social/trades/${encodeURIComponent(handle)}?after=${after}`);

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

export function money(v: number) {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}K` : a.toFixed(2);
  return `${v < 0 ? "−" : ""}$${s}`;
}
