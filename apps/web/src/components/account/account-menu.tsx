"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { signOut, useAccount } from "@/lib/account";
import { useKixoWallet } from "@/lib/kixo-wallet";
import { WalletButton } from "@/components/wallet/kixo-wallet-card";
import { useSettings } from "@/lib/settings";
import { setMode, useDemo } from "@/lib/demo";
import { useFeatures } from "@/lib/features";

const METHOD: Record<string, string> = { google: "Google", email: "Email", phantom: "Phantom" };

/** Top bar: "Sign in" when signed out, otherwise the account and its wallet. */
export function AccountMenu() {
  const account = useAccount();
  const features = useFeatures();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const demo = useDemo();
  const kixo = useKixoWallet();

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
  const wallet = kixo.info?.exists ? kixo.info.pubkey : null;
  return (
    <div ref={box} className="relative flex items-center gap-1.5 sm:gap-2">
      <ModeSwitch />
      {demo.mode === "demo" ? <DemoChip /> : <WalletButton />}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
      >
        <User size={16} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg shadow-black/40">
          <div className="px-2 py-2">
            <p className="flex items-center gap-2 text-sm text-text">
              <User size={14} strokeWidth={1.5} className="text-text-2" />
              <span className="truncate">{me?.email ?? "Wallet account"}</span>
            </p>
            <p className="mt-1 text-xs text-muted">Signed in with {METHOD[me?.login_method ?? ""] ?? "Kixo"}</p>
            {wallet && (
              <p className="mt-2 text-xs text-muted">
                Kixo wallet <span className="break-all font-mono text-cyan">{wallet}</span>
              </p>
            )}
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

/** One click between the virtual demo account and the real wallet. */
/** Settings: the account mode to open in after signing in. */
const applyStartMode = (m: "demo" | "real") => setMode(m);

function ModeSwitch() {
  const { mode, enabled } = useDemo();
  useSettings(applyStartMode);
  if (!enabled) return null;
  return (
    <div role="group" aria-label="Account mode" className="flex h-9 items-center rounded-lg border border-border bg-surface p-0.5 text-xs">
      {(["demo", "real"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={`h-full rounded-md px-2.5 capitalize transition-colors ${mode === m ? (m === "demo" ? "bg-warning/15 text-warning" : "bg-surface-3 text-text") : "text-text-2 hover:text-text"}`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

/** Demo balance: equity at live prices. */
function DemoChip() {
  const { account } = useDemo();
  return (
    <Link href="/portfolio" className="flex h-9 items-center gap-2 rounded-lg border border-warning/30 bg-surface px-2.5 text-sm sm:px-3 transition-colors hover:bg-surface-2" title="Demo account value at live prices">
      <span data-private className="font-mono text-xs tabular-nums text-text">
        {account ? account.equity_usd.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "…"}
      </span>
      <span className="hidden text-[11px] text-warning sm:inline">Demo</span>
    </Link>
  );
}
