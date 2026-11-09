"use client";

import { KixoLogo } from "@/components/brand";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { Turnstile, TURNSTILE_SITE_KEY, type TurnstileHandle } from "./turnstile";
import { authError, safeNext, sendEmailCode, signInWithGoogle, useAccount, verifyEmailCode } from "@/lib/account";
import { useFeatures } from "@/lib/features";

type Busy = null | "google" | "send" | "verify";

/** Sign in with Google or an email code. Phantom is for deposits and direct trades,
 *  not for signing in: each account gets its Kixo wallet on its email. */
export function LoginPanel({ next: nextProp, inPopup = false, onDone }: { next?: string; inPopup?: boolean; onDone?: () => void } = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(nextProp ?? params.get("next"));
  const account = useAccount();
  const features = useFeatures();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "Sign-in did not finish, try again" : null);
  const [step, setStep] = useState<"choose" | "email" | "code">("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);
  // Bot check before an email code is sent (off when no Turnstile key is set).
  const [captcha, setCaptcha] = useState("");
  const check = useRef<TurnstileHandle>(null);
  const captchaOk = !TURNSTILE_SITE_KEY || captcha.length > 0;

  useEffect(() => {
    if (account.status !== "signed-in") return;
    onDone?.();
    if (!inPopup || nextProp) router.replace(next);
  }, [account.status, next, router, onDone, inPopup, nextProp]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(null);
    }
  }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  return (
    <div className="w-full max-w-[400px]">
      {!inPopup && (
        <Link href="/" className="mb-8 flex items-center gap-2 text-sm text-text-2 hover:text-text">
          <KixoLogo size={28} text="text-lg" />
        </Link>
      )}

      <div className="rounded-2xl border border-border bg-surface p-6">
        {!features.accounts ? (
          <p className="text-sm text-text-2">Sign-in is paused for a short while. You can keep using Discover and Sol Radar.</p>
        ) : step === "choose" ? (
          <>
            <h1 className="text-xl font-medium text-text">Sign in to Kixo</h1>
            <p className="mt-1 text-sm text-text-2">Track Solana memecoins, wallets and your sniper in one account</p>

            <div className="mt-6 flex flex-col gap-2">
              <MethodButton onClick={() => run("google", () => signInWithGoogle(next))} busy={busy === "google"} disabled={!!busy} icon={<GoogleMark />}>
                Continue with Google
              </MethodButton>
              <MethodButton onClick={() => setStep("email")} disabled={!!busy} icon={<Mail size={16} strokeWidth={1.5} />}>
                Sign up or sign in with email
              </MethodButton>
            </div>
          </>
        ) : step === "email" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (emailOk && captchaOk) run("send", async () => { try { await sendEmailCode(email.trim(), captcha); } finally { check.current?.reset(); } setStep("code"); });
            }}
          >
            <BackButton onClick={() => { setStep("choose"); setError(null); }} />
            <h1 className="text-xl font-medium text-text">Sign in with email</h1>
            <p className="mt-1 text-sm text-text-2">We send a 6-digit code. No password to remember</p>
            <label className="mt-6 block text-xs text-text-2" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-emerald/50"
              placeholder="you@example.com"
            />
            <Turnstile ref={check} onToken={setCaptcha} />
            <SubmitButton disabled={!emailOk || !captchaOk || !!busy} busy={busy === "send"}>Send code</SubmitButton>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) run("verify", () => verifyEmailCode(email.trim(), code));
            }}
          >
            <BackButton onClick={() => { setStep("email"); setCode(""); setError(null); }} />
            <h1 className="text-xl font-medium text-text">Enter the code</h1>
            <p className="mt-1 text-sm text-text-2">
              Sent to <span className="text-text">{email.trim()}</span>. It works for 10 minutes
            </p>
            <input
              ref={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="6-digit code"
              className="mt-6 h-12 w-full rounded-lg border border-border bg-bg px-3 text-center font-mono text-xl tracking-[0.4em] text-text tabular-nums outline-none transition-colors focus:border-emerald/50"
              placeholder="000000"
            />
            <SubmitButton disabled={code.length !== 6 || !!busy} busy={busy === "verify"}>Sign in</SubmitButton>
            <Turnstile ref={check} onToken={setCaptcha} />
            <button
              type="button"
              disabled={!!busy || !captchaOk}
              onClick={() => run("send", async () => { try { await sendEmailCode(email.trim(), captcha); } finally { check.current?.reset(); } })}
              className="mt-3 w-full text-center text-xs text-text-2 hover:text-text disabled:opacity-50"
            >
              Send a new code
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-negative/20 bg-negative/10 px-3 py-2 text-sm text-negative">
            {error}
          </p>
        )}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted">
        Kixo never asks for your seed phrase and signing in never moves funds
      </p>
    </div>
  );
}

function MethodButton({ children, icon, onClick, busy, disabled }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 text-sm text-text transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald/60 disabled:opacity-60"
    >
      <span className="flex w-4 justify-center text-text-2">{busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : icon}</span>
      {children}
    </button>
  );
}

function SubmitButton({ children, busy, disabled }: { children: React.ReactNode; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-text text-sm font-medium text-bg transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald/60 disabled:opacity-40"
    >
      {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
      {children}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-ml-1 mb-4 flex items-center gap-1 text-xs text-text-2 hover:text-text">
      <ArrowLeft size={14} strokeWidth={1.5} />
      Back
    </button>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
