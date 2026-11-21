"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/* The browser's Supabase client: the same project as the Kixo app, so the account made
   here is the account people sign in to after launch. Public URL and anon key only. */

let client: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key && typeof window !== "undefined" ? createBrowserClient(url, key) : null;
  return client;
}

/** Where Google and email links come back to, then on to the pass. */
export const callbackUrl = () => `${window.location.origin}/auth/callback`;

const REF_KEY = "kixo.ref";
const SRC_KEY = "kixo.src";

/** Keeps `?ref=` and `utm_source` from the address bar across the Google round trip. */
export function rememberRef() {
  try {
    const q = new URLSearchParams(window.location.search);
    const ref = q.get("ref")?.trim().toLowerCase();
    if (ref && /^[a-z0-9]{6,12}$/.test(ref)) localStorage.setItem(REF_KEY, ref);
    const src = (q.get("utm_source") ?? q.get("src"))?.trim().slice(0, 64);
    if (src) localStorage.setItem(SRC_KEY, src);
  } catch {}
}

export function savedRef(): { ref: string | null; source: string | null } {
  try {
    return { ref: localStorage.getItem(REF_KEY), source: localStorage.getItem(SRC_KEY) };
  } catch {
    return { ref: null, source: null };
  }
}
