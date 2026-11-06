"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { safeNext } from "@/lib/account";
import { supabase } from "@/lib/supabase";

/** Google returns here with a one-time code; swap it for a session, then go on. */
function Callback() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const code = params.get("code");
    const next = safeNext(params.get("next"));
    const sb = supabase();
    if (!sb || !code) {
      router.replace(`/login?error=1&next=${encodeURIComponent(next)}`);
      return;
    }
    sb.auth.exchangeCodeForSession(code).then(({ error }) => {
      router.replace(error ? `/login?error=1&next=${encodeURIComponent(next)}` : next);
    });
  }, [params, router]);

  return null;
}

export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center gap-2 bg-bg text-sm text-text-2">
      <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
      Signing you in
      <Suspense fallback={null}>
        <Callback />
      </Suspense>
    </main>
  );
}
