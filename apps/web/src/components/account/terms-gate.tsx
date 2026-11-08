"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { acceptTerms, authError, signOut, useAccount } from "@/lib/account";
import { useFeatures } from "@/lib/features";

const POINTS: { title: string; body: string }[] = [
  {
    title: "Not financial advice",
    body: "Scores, flags and AI notes are information, not advice. Memecoins are very risky and can lose all their value in minutes. Only trade what you can afford to lose",
  },
  {
    title: "Your keys stay yours",
    body: "We never ask for your seed phrase or private key. Your Kixo wallet is made and locked with your password in your browser; we keep only the locked copy and cannot open it. Trades you sign cannot be undone",
  },
  {
    title: "What we keep",
    body: "Your sign-in details, your demo and real trade records, settings and support messages, to run and secure Kixo. We do not sell your data. Download or delete it any time in Settings",
  },
  {
    title: "Your responsibility",
    body: "You are 18 or older, trading is allowed where you live, and you make your own trading decisions. Automatic orders, grids and copies run only while Kixo is open in your browser",
  },
];

/** Shown once after sign-in (and again if the terms change). Acceptance is saved on the
 *  account with its time and version. */
export function TermsGate() {
  const account = useAccount();
  const features = useFeatures();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!features.accounts || account.status !== "signed-in" || account.accepted) return null;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptTerms();
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-12 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="w-full max-w-[480px] rounded-2xl border border-border bg-surface p-6">
        <h2 id="terms-title" className="text-xl font-medium text-text">Before you start</h2>
        <p className="mt-1 text-sm text-text-2">
          Please read and accept how Kixo works. The full{" "}
          <a href="/terms" target="_blank" rel="noopener" className="text-text underline underline-offset-2">Terms of Use</a> and{" "}
          <a href="/privacy" target="_blank" rel="noopener" className="text-text underline underline-offset-2">Privacy Policy</a> apply
        </p>
        <dl className="mt-5 flex flex-col gap-4">
          {POINTS.map((p) => (
            <div key={p.title} className="border-l border-border pl-3">
              <dt className="text-sm font-medium text-text">{p.title}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-text-2">{p.body}</dd>
            </div>
          ))}
        </dl>
        {error && <p role="alert" className="mt-4 rounded-lg border border-negative/20 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-text text-sm font-medium text-bg transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald/60 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
          Accept and continue
        </button>
        <button type="button" onClick={() => signOut()} className="mt-3 w-full text-center text-xs text-text-2 hover:text-text">
          Decline and sign out
        </button>
      </div>
    </div>
  );
}
