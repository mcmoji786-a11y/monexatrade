"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { authError, linkWallet, needsWallet, signOut, useAccount } from "@/lib/account";
import { phantom, PHANTOM_INSTALL } from "@/lib/phantom";
import { useFeatures } from "@/lib/features";
import { pushToast } from "@/lib/toast";

/** Google and email accounts must link a wallet before going on. Phantom accounts
 *  already proved theirs when they signed in, so they never see this. */
export function WalletGate() {
  const account = useAccount();
  const features = useFeatures();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPhantom, setHasPhantom] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setHasPhantom(!!phantom()), 300);
    return () => clearTimeout(t);
  }, []);

  if (!features.accounts || !needsWallet(account)) return null;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const me = await linkWallet();
      pushToast({ tone: "good", title: "Wallet linked", body: me.wallet ?? undefined });
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="wallet-gate-title">
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-surface p-6">
        <h2 id="wallet-gate-title" className="text-xl font-medium text-text">Link your wallet</h2>
        <p className="mt-1 text-sm text-text-2">
          Your MONEXA account needs one Solana wallet. Phantom asks you to sign a short message that proves the wallet is yours
        </p>
        <ul className="mt-5 flex flex-col gap-2 text-sm text-text-2">
          <li className="flex gap-2"><ShieldCheck size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-emerald" />Signing costs nothing and never moves funds</li>
          <li className="flex gap-2"><ShieldCheck size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-emerald" />We never ask for your seed phrase</li>
          <li className="flex gap-2"><ShieldCheck size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-emerald" />One wallet belongs to one account</li>
        </ul>
        {hasPhantom ? (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-text text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <Wallet size={16} strokeWidth={1.5} />}
            Connect Phantom
          </button>
        ) : (
          <a href={PHANTOM_INSTALL} target="_blank" rel="noopener noreferrer" className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-text text-sm font-medium text-bg hover:opacity-90">
            <Wallet size={16} strokeWidth={1.5} />
            Install Phantom
          </a>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg border border-negative/20 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
        <button type="button" onClick={() => signOut()} className="mt-4 w-full text-center text-xs text-text-2 hover:text-text">
          Sign out
        </button>
      </div>
    </div>
  );
}
