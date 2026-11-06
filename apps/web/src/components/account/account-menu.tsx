"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { signOut, useAccount } from "@/lib/account";
import { useFeatures } from "@/lib/features";
import { shortAddress } from "@/lib/gateway";

const METHOD: Record<string, string> = { google: "Google", email: "Email", phantom: "Phantom" };

/** Top bar: "Sign in" when signed out, otherwise the account and its wallet. */
export function AccountMenu() {
  const account = useAccount();
  const features = useFeatures();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!features.accounts) return null;
  if (account.status === "loading") return <div className="h-9 w-20 rounded-lg bg-surface-2" aria-hidden="true" />;
  if (account.status === "signed-out") {
    return (
      <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="flex h-9 items-center rounded-lg bg-text px-3 text-sm font-medium text-bg transition-opacity hover:opacity-90">
        Sign in
      </Link>
    );
  }

  const me = account.me;
  const label = me?.wallet ? shortAddress(me.wallet) : (me?.email ?? "Account");
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text transition-colors hover:bg-surface-2"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${me?.wallet_verified ? "bg-emerald" : "bg-warning"}`} aria-hidden="true" />
        <span className={me?.wallet ? "font-mono text-xs" : "max-w-40 truncate"}>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg shadow-black/40">
          <div className="px-2 py-2">
            <p className="flex items-center gap-2 text-sm text-text">
              <User size={14} strokeWidth={1.5} className="text-text-2" />
              <span className="truncate">{me?.email ?? "Wallet account"}</span>
            </p>
            <p className="mt-1 text-xs text-muted">Signed in with {METHOD[me?.login_method ?? ""] ?? "MONEXA"}</p>
            {me?.wallet && <p className="mt-2 break-all font-mono text-xs text-cyan">{me.wallet}</p>}
            {account.error && <p className="mt-2 text-xs text-warning">{account.error}</p>}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); signOut(); }}
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-2 hover:bg-surface-2 hover:text-text"
          >
            <LogOut size={14} strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
