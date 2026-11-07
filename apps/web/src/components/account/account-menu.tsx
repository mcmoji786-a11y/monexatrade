"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, LogOut, Unplug, User, Wallet } from "lucide-react";
import { activeWallet, authError, connectWallet, disconnectWallet, signOut, useAccount } from "@/lib/account";
import { phantom, PHANTOM_INSTALL } from "@/lib/phantom";
import { pushToast } from "@/lib/toast";
import { useSettings } from "@/lib/settings";
import { setMode, useDemo } from "@/lib/demo";
import { useFeatures } from "@/lib/features";
import { GATEWAY_HTTP, shortAddress } from "@/lib/gateway";

const METHOD: Record<string, string> = { google: "Google", email: "Email", phantom: "Phantom" };

/** Top bar: "Sign in" when signed out, otherwise the account and its wallet. */
export function AccountMenu() {
  const account = useAccount();
  const features = useFeatures();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const demo = useDemo();

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
  const wallet = activeWallet(account);
  const isPhantom = me?.login_method === "phantom";
  return (
    <div ref={box} className="relative flex items-center gap-2">
      <ModeSwitch />
      {demo.mode === "demo" ? <DemoChip /> : wallet ? <WalletChip wallet={wallet} /> : <ConnectWallet />}
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
            {wallet && <p className="mt-2 break-all font-mono text-xs text-cyan">{wallet}</p>}
            {account.error && <p className="mt-2 text-xs text-warning">{account.error}</p>}
          </div>
          {wallet && !isPhantom && (
            <button
              type="button"
              onClick={() => { setOpen(false); disconnectWallet(); }}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-2 hover:bg-surface-2 hover:text-text"
            >
              <Unplug size={14} strokeWidth={1.5} />
              Disconnect wallet
            </button>
          )}
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

/** "Connect wallet": Phantom asks permission; the wallet is used for this visit only. */
function ConnectWallet() {
  const [busy, setBusy] = useState(false);
  async function connect() {
    if (!phantom()) {
      pushToast({ tone: "bad", title: "Phantom not found", body: "Unlock Phantom or refresh the page. Not installed? Click here", href: PHANTOM_INSTALL });
      return;
    }
    setBusy(true);
    try {
      const w = await connectWallet();
      pushToast({ tone: "good", title: "Wallet connected", body: shortAddress(w) });
    } catch (e) {
      pushToast({ tone: "bad", title: "Wallet not connected", body: authError(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={connect}
      disabled={busy}
      className="flex h-9 items-center gap-2 rounded-lg bg-text px-3 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <Wallet size={16} strokeWidth={1.5} />}
      Connect wallet
    </button>
  );
}

/** The linked wallet and its SOL balance, refreshed every 30 seconds. */
function WalletChip({ wallet }: { wallet: string }) {
  const [sol, setSol] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${GATEWAY_HTTP}/wallet/${wallet}/balance`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => alive && v && typeof v.sol === "number" && setSol(v.sol))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [wallet]);
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm" title={wallet}>
      <span className="font-mono text-xs tabular-nums text-text">{sol === null ? "…" : `${sol < 1000 ? sol.toFixed(3) : sol.toFixed(0)} SOL`}</span>
      <span className="h-3 w-px bg-border" aria-hidden="true" />
      <span className="font-mono text-xs text-text-2">{shortAddress(wallet)}</span>
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
    <Link href="/portfolio" className="flex h-9 items-center gap-2 rounded-lg border border-warning/30 bg-surface px-3 text-sm transition-colors hover:bg-surface-2" title="Demo account value at live prices">
      <span className="font-mono text-xs tabular-nums text-text">
        {account ? account.equity_usd.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "…"}
      </span>
      <span className="text-[11px] text-warning">Demo</span>
    </Link>
  );
}
