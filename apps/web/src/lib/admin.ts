"use client";

/**
 * The admin session in this tab.
 * - The admin key (ADMIN_TOKEN) is kept in sessionStorage until the tab closes.
 * - The owner session (from a code emailed to OWNER_EMAIL) is kept in memory only and
 *   lasts 15 minutes. Money and API-key changes need it.
 */

import { useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";

const KEY = "kixo.admin.key";
let owner: { token: string; until: number } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function adminKey(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useAdminKey(): string | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    adminKey,
    () => null,
  );
}

/** Checks the admin key with the gateway and keeps it for this tab. */
export async function signInAdmin(key: string) {
  const r = await fetch(`${GATEWAY_HTTP}/admin/check`, { headers: { "x-admin-token": key.trim() }, cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 403 ? "Wrong admin key" : `The gateway answered ${r.status}`);
  try {
    sessionStorage.setItem(KEY, key.trim());
  } catch {}
  emit();
}

export function signOutAdmin() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  owner = null;
  emit();
}

export const ownerActive = () => !!owner && owner.until > Date.now();

export function useOwner(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      const t = setInterval(f, 15_000);
      return () => {
        subs.delete(f);
        clearInterval(t);
      };
    },
    ownerActive,
    () => false,
  );
}

/** Thrown when a change needs the owner's emailed code first. */
export class OwnerNeeded extends Error {
  constructor() {
    super("This change needs the owner code");
  }
}

/** A call to an admin route with the admin key (and the owner session when open). */
export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = adminKey();
  if (!key) throw new Error("Sign in to the admin first");
  const headers: Record<string, string> = { "x-admin-token": key, "content-type": "application/json" };
  if (ownerActive()) headers["x-owner-session"] = owner!.token;
  const res = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  let v: unknown = null;
  try {
    v = JSON.parse(text);
  } catch {}
  const msg = (v as { message?: string } | null)?.message ?? text;
  if (res.status === 401 && /owner_code_required/.test(msg)) {
    owner = null;
    emit();
    throw new OwnerNeeded();
  }
  if (res.status === 403) {
    signOutAdmin();
    throw new Error("The admin key is no longer valid. Sign in again");
  }
  if (!res.ok) throw new Error(msg.slice(0, 200) || `Failed (${res.status})`);
  return v as T;
}

/** Emails the owner a code. Returns the masked address. */
export async function sendOwnerCode(): Promise<string> {
  const r = await adminFetch<{ sent_to: string }>("/admin/owner/code", { body: {} });
  return r.sent_to;
}

/** Checks the owner code and opens a 15-minute owner session in this tab. */
export async function verifyOwnerCode(code: string) {
  const r = await adminFetch<{ session: string; expires_in: number }>("/admin/owner/verify", { body: { code } });
  owner = { token: r.session, until: Date.now() + r.expires_in * 1000 - 5_000 };
  emit();
}

/** Downloads an admin CSV export as a file. */
export async function adminDownload(path: string, filename: string) {
  const key = adminKey();
  if (!key) throw new Error("Sign in to the admin first");
  const res = await fetch(`${GATEWAY_HTTP}${path}`, { headers: { "x-admin-token": key }, cache: "no-store" });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
