import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginPanel } from "@/components/account/login-panel";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <Suspense fallback={null}>
        <LoginPanel />
      </Suspense>
    </main>
  );
}
