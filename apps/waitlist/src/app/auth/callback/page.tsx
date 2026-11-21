"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

/** Google (or an email link) returns here with a one-time code: swap it for a session,
 *  then back to the page, which shows the pass. */
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const code = params.get("code");
    const sb = supabase();
    if (!sb || !code) {
      router.replace("/?signin=failed#join");
      return;
    }
    sb.auth.exchangeCodeForSession(code).then(({ error }) => router.replace(error ? "/?signin=failed#join" : "/#pass"));
  }, [params, router]);
  return null;
}

export default function AuthCallbackPage() {
  return (
    <main className="callback">
      <span className="spinner" aria-hidden="true" />
      Signing you in
      <Suspense fallback={null}>
        <Callback />
      </Suspense>
    </main>
  );
}
