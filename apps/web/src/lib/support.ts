"use client";

import { useEffect, useRef, useState } from "react";
import { GATEWAY_HTTP, GATEWAY_WS } from "./gateway";
import { accessToken, useAccount } from "./account";

/* Support center: the Transaction Doctor and tickets (gateway support.rs). */

async function call<T>(method: string, path: string, body?: unknown, admin?: string): Promise<T> {
  const token = accessToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (admin) headers["x-admin-token"] = admin;
  else if (token) headers.authorization = `Bearer ${token}`;
  else throw new Error("Sign in first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(res.status === 403 && admin ? "Wrong admin key" : text || `Request failed (${res.status})`);
  return JSON.parse(text) as T;
}

export type Diagnosis = {
  signature: string;
  explorer: string;
  status: "confirmed" | "failed" | "pending" | "not_found";
  title: string;
  explain: string;
  next: string;
  code?: string;
  time?: number | null;
  fee_lamports?: number;
  sol_change_lamports?: number | null;
  token_changes?: { mint: string; change: number }[];
  logs?: string[];
  ours?: { side: string; symbol: string; mint: string; status: string; platform_fee_lamports: number } | null;
};

export const diagnose = (signature: string) => call<Diagnosis>("POST", "/support/diagnose", { signature });

export type Category = "trade" | "wallet" | "account" | "bug" | "other";
export type Status = "open" | "in_progress" | "waiting" | "resolved";
export type Ticket = {
  id: number;
  category: Category;
  subject: string;
  status: Status;
  priority: "low" | "normal" | "high" | "urgent";
  signature: string | null;
  user_unread?: boolean;
  admin_unread?: boolean;
  channel?: "ticket" | "live";
  agent?: string | null;
  email?: string | null;
  context?: Record<string, string | null>;
  created_at: string;
  updated_at: string;
};
export type Message = { id: number; author: "user" | "support"; agent?: string | null; body: string; internal?: boolean; created_at: string };

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "trade", label: "A trade or transaction" },
  { value: "wallet", label: "Wallet or Phantom" },
  { value: "account", label: "Account, sign-in or settings" },
  { value: "bug", label: "Something is broken" },
  { value: "other", label: "Something else" },
];

export const STATUS_LABEL: Record<Status, string> = { open: "Open", in_progress: "In progress", waiting: "Waiting for you", resolved: "Resolved" };

/** What we attach to a new ticket so support can see the situation at once. */
export function ticketContext(mode: string, wallet: string | null) {
  return {
    page: typeof document !== "undefined" ? document.referrer || window.location.pathname : "",
    browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
    screen: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
    mode,
    wallet,
  };
}

export const createTicket = (t: { category: Category; subject: string; body: string; signature?: string; context: unknown; channel?: "ticket" | "live" }) => call<{ id: number }>("POST", "/support/tickets", t);
export const listTickets = () => call<Ticket[]>("GET", "/support/tickets");
export const getTicket = (id: number) => call<{ ticket: Ticket; messages: Message[] }>("GET", `/support/tickets/${id}`);
export const replyTicket = (id: number, body: string) => call("POST", `/support/tickets/${id}/messages`, { body });

/** Unread support replies, for the badge on Support in the navigation. */
export function useSupportUnread() {
  const signedIn = useAccount().status === "signed-in";
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const load = () =>
      document.visibilityState === "visible" &&
      call<{ unread: number }>("GET", "/support/unread")
        .then((r) => alive && setN(r.unread))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener("mx:support-read", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("mx:support-read", load);
    };
  }, [signedIn]);
  return signedIn ? n : 0;
}

/* ---------------- Live chat ---------------- */

export type LiveState = { enabled: boolean; online: boolean; chat: { ticket: Ticket; messages: Message[] } | null };
/** The open live chat. `peek` reads it without marking replies as seen. */
export const liveCurrent = (peek: boolean) => call<LiveState>("GET", `/support/live${peek ? "?peek=true" : ""}`);
export const startChat = (body: string, context: unknown) => createTicket({ category: "other", subject: "", body, context, channel: "live" });
/** The message the gateway sends back when someone pastes a recovery phrase or key. */
export const isSecretRefusal = (e: unknown) => e instanceof Error && /recovery phrase or private key/.test(e.message);

export type SupportEvent = { type: "hello" | "presence" | "new" | "message" | "read" | "status" | "typing" | "error"; ticket?: number; online?: boolean; enabled?: boolean; who?: "user" | "support"; agent?: string | null; by?: "user" | "support"; live?: boolean; error?: string };

/* One socket per browser tab for the signed-in user, shared by every component that
   listens. Events only name what changed; listeners then re-read through the API. */
const listeners = new Set<(e: SupportEvent) => void>();
let sock: WebSocket | null = null;
let users = 0;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function connect() {
  const token = accessToken();
  if (!token || sock) return;
  const ws = new WebSocket(`${GATEWAY_WS}/support/ws`);
  sock = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ token }));
    retry = 0;
  };
  ws.onmessage = (m) => {
    let e: SupportEvent;
    try {
      e = JSON.parse(String(m.data));
    } catch {
      return;
    }
    listeners.forEach((l) => l(e));
    if (e.type === "message" || e.type === "read" || e.type === "new" || e.type === "status") window.dispatchEvent(new Event("mx:support-read"));
  };
  ws.onclose = () => {
    if (sock === ws) sock = null;
    if (users > 0) timer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry++));
  };
}

/** Listen to live support events while `on` (the user is signed in). */
export function useSupportEvents(handler: (e: SupportEvent) => void, on: boolean) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!on) return;
    const l = (e: SupportEvent) => ref.current(e);
    listeners.add(l);
    users++;
    connect();
    return () => {
      listeners.delete(l);
      users--;
      if (users === 0) {
        clearTimeout(timer);
        sock?.close();
        sock = null;
      }
    };
  }, [on]);
}

/** Tell the team the user is typing in a chat (the gateway limits how often). */
export function sendTyping(ticket: number) {
  if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "typing", ticket }));
}

/* Admin inbox (needs ADMIN_TOKEN). */
export const adminTickets = (key: string, status: string) => call<Ticket[]>("GET", `/admin/support/tickets?status=${status}`, undefined, key);
export const adminTicket = (key: string, id: number) => call<{ ticket: Ticket; messages: Message[] }>("GET", `/admin/support/tickets/${id}`, undefined, key);
export const adminReply = (key: string, id: number, body: string, internal: boolean, agent: string) => call("POST", `/admin/support/tickets/${id}/messages`, { body, internal, agent }, key);
export const adminUpdate = (key: string, id: number, patch: { status?: Status; priority?: string }) => call("POST", `/admin/support/tickets/${id}/status`, patch, key);
export const adminClaim = (key: string, id: number, agent: string, force: boolean) => call<{ agent: string }>("POST", `/admin/support/tickets/${id}/claim`, { agent, force }, key);
export type TeamPresence = { switch: boolean; online: boolean; enabled: boolean };
export const adminPresence = (key: string) => call<TeamPresence>("GET", "/admin/support/presence", undefined, key);
export const adminSetPresence = (key: string, online: boolean) => call<TeamPresence>("POST", "/admin/support/presence", { online }, key);
