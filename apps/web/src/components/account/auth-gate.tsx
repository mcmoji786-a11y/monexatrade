"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { closeLogin, openLogin, useAccount, useLoginPopup } from "@/lib/account";
import { useFeatures } from "@/lib/features";
import { LoginPanel } from "./login-panel";

/** App pages need an account. Signed-out visitors get the sign-in popup instead of the
 *  page; signed-in pages render at once from the cached profile. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const features = useFeatures();
  const pathname = usePathname();

  if (!features.accounts) return children;
  if (account.status === "signed-in") return children;
  if (account.status === "loading") return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-bg/85 px-4 py-12 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Sign in">
      <LoginPanel next={pathname} inPopup />
    </div>
  );
}

/** Landing "Trade now": straight in when signed in, otherwise the sign-in popup. */
export function TradeNowButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const account = useAccount();
  const features = useFeatures();
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={() => (account.status === "signed-in" || !features.accounts ? router.push("/discover") : openLogin("/discover"))}
    >
      {children}
    </button>
  );
}

/** The sign-in popup opened by openLogin(). Escape or the close button dismisses it. */
export function LoginPopup() {
  const next = useLoginPopup();

  useEffect(() => {
    if (!next) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeLogin();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);

  if (!next) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-12" role="dialog" aria-modal="true" aria-label="Sign in">
      <button type="button" aria-label="Close" onClick={closeLogin} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-[400px]">
        <button
          type="button"
          onClick={closeLogin}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
        <LoginPanel next={next} inPopup onDone={closeLogin} />
      </div>
    </div>
  );
}
