"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/* One Supabase client for the browser. Only the public URL and anon key live here;
   the service-role key stays in the gateway. Sessions are kept in cookies and refreshed
   by the client itself, so no page waits on a server auth check. */

let client: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key && typeof window !== "undefined" ? createBrowserClient(url, key) : null;
  return client;
}
