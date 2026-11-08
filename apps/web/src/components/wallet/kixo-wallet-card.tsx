"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, ClipboardPaste, Copy, Download, KeyRound, Loader2, Lock, ShieldCheck, Ticket, Wallet } from "lucide-react";
import { getPromo, redeemPromo, type PromoState } from "@/lib/marketing";
import { useAccount } from "@/lib/account";
import {
  createWallet,
  downloadRecovery,
  exportRecovery,
  lockWallet,
  passwordProblem,
  recoverySaved,
  refreshBalance,
  refreshWallet,
  sendWalletCode,
  depositFeeBps,
  withdrawFeeBps,
  connectPhantom,
  depositFromPhantom,
  usePhantomAddress,
  setTwoFa,
  unlockWallet,
  useKixoBalance,
  useKixoWallet,
  waitForTransfer,
  walletSupported,
  withdrawSol,
  WalletError,
} from "@/lib/kixo-wallet";
import { pushToast } from "@/lib/toast";
import { shortAddress } from "@/lib/gateway";
import { usePortfolio } from "@/lib/portfolio";

const input = "h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-emerald/50";
const primary = "flex h-10 items-center justify-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40";
const quiet = "flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong, try again");
const fmtSol = (v: number) => (v < 1000 ? v.toFixed(4) : v.toFixed(2));

/** Loads the account's Kixo wallet once the account is known. */
function useWalletSync() {
  const account = useAccount();
  useEffect(() => {
    if (account.status !== "loading") void refreshWallet();
  }, [account.status, account.me?.id]);
}

/* ---------------- Top bar: balance, deposit and withdraw ---------------- */

/** The Kixo wallet in the top bar: its SOL balance, and a panel with deposit, withdraw,
 *  recovery file, 2FA and lock. */
export function WalletButton() {
  useWalletSync();
  const w = useKixoWallet();
  const sol = useKixoBalance();
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

  if (w.status === "signed-out" || w.status === "loading") return null;
  const label = w.status === "none" ? "Set up wallet" : w.status === "error" ? "Wallet" : sol === null ? "… SOL" : `${fmtSol(sol)} SOL`;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Kixo wallet"
        className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${w.status === "none" ? "bg-text font-medium text-bg hover:opacity-90" : "border border-border bg-surface text-text hover:bg-surface-2"}`}
      >
        {w.status === "locked" ? <Lock size={14} strokeWidth={1.5} className="text-text-2" /> : <Wallet size={14} strokeWidth={1.5} className={w.status === "none" ? "" : "text-text-2"} />}
        <span data-private={w.status === "none" ? undefined : true} className={w.status === "none" ? "" : "font-mono text-xs tabular-nums"}>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-[380px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-surface p-5 shadow-lg shadow-black/40">
          <WalletPanel compact />
        </div>
      )}
    </div>
  );
}

/** The wallet in every state: set up, unlock, or open with deposit and withdraw. */
export function WalletPanel({ compact = false }: { compact?: boolean }) {
  const w = useKixoWallet();
  if (w.status === "loading")
    return (
      <p className="flex items-center gap-2 text-sm text-text-2">
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
        Loading your Kixo wallet
      </p>
    );
  if (w.status === "signed-out") return null;
  if (w.status === "error") return <p className="text-sm text-text-2">{w.error === "not set up yet: run the latest migration" ? "Kixo wallets are not set up on the server yet" : w.error}</p>;
  if (w.recovery) return <Recovery address={w.recovery.address} text={w.recovery.text} />;
  if (w.status === "none") return <Create compact={compact} />;
  if (w.status === "locked") return <Unlock twoFa={!!w.info?.two_fa} />;
  return <Open address={w.info?.pubkey ?? ""} twoFa={!!w.info?.two_fa} deposits={!!w.info?.deposits} />;
}

/** Portfolio: the same wallet panel in a card. */
export function KixoWalletCard() {
  useWalletSync();
  const w = useKixoWallet();
  if (w.status === "signed-out") return null;
  return (
    <section className="max-w-xl rounded-xl border border-border bg-surface p-5">
      <WalletPanel />
    </section>
  );
}

/* ---------------- After sign-up: set up the wallet ---------------- */

const LATER_KEY = "kixo.wallet.later";

/** Right after signing up, the wallet is set up in one step: the user picks the wallet
 *  password and the wallet is made for their account. */
export function WalletSetupGate() {
  useWalletSync();
  const w = useKixoWallet();
  const [later, setLater] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(LATER_KEY) === "1";
    } catch {
      return false;
    }
  });
  const show = (w.status === "none" && !later) || !!w.recovery;
  if (!show) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Set up your Kixo wallet" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-[480px] rounded-2xl border border-border bg-surface p-6">
        <WalletPanel compact />
        {!w.recovery && (
          <button
            type="button"
            onClick={() => {
              try {
                sessionStorage.setItem(LATER_KEY, "1");
              } catch {}
              setLater(true);
            }}
            className="mt-4 text-xs text-text-2 hover:text-text"
          >
            Later. Demo trading works without it
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- States ---------------- */

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-base font-medium text-text">{title}</h2>
      <p className="mt-1 max-w-xl text-sm text-text-2">{sub}</p>
    </div>
  );
}

function Create({ compact }: { compact: boolean }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    void walletSupported().then(setSupported);
  }, []);

  const problem = pw ? passwordProblem(pw) : null;
  const mismatch = again && again !== pw ? "The passwords do not match" : null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await createWallet(pw);
          setPw("");
          setAgain("");
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Header title="Set up your Kixo wallet" sub="Your trading wallet, tied to this account. Pick a wallet password: it locks the key in this browser, and Kixo stores only the locked copy, which it can never open" />
      {!supported ? (
        <p className="text-sm text-warning">This browser cannot create the wallet. Update it or use Chrome, Edge, Firefox or Safari</p>
      ) : (
        <>
          <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
            <div>
              <label htmlFor="kw-pw" className="text-xs text-text-2">Wallet password</label>
              <input id="kw-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={`${input} mt-2`} />
            </div>
            <div>
              <label htmlFor="kw-pw2" className="text-xs text-text-2">Repeat it</label>
              <input id="kw-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={`${input} mt-2`} />
            </div>
          </div>
          <p className="text-xs text-muted">{problem ?? mismatch ?? "Separate from your Google or email login. At least 10 characters"}</p>
          {error && <p role="alert" className="text-sm text-negative">{error}</p>}
          <button type="submit" disabled={busy || !!problem || !pw || again !== pw} className={`${primary} w-fit`}>
            {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <KeyRound size={16} strokeWidth={1.5} />}
            Create wallet
          </button>
        </>
      )}
    </form>
  );
}

function Recovery({ address, text }: { address: string; text: string }) {
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Header title="Save your recovery file" sub="If you forget your wallet password, this file is the only way back in. Kixo cannot reset it, because Kixo never has your key" />
      <p data-private className="font-mono text-xs text-cyan">{shortAddress(address)}</p>
      <button
        type="button"
        className={`${quiet} w-fit`}
        onClick={() => {
          downloadRecovery(text, address);
          setDownloaded(true);
        }}
      >
        <Download size={16} strokeWidth={1.5} />
        Download recovery file
      </button>
      <label className="flex items-start gap-2 text-sm text-text-2">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 accent-emerald" />
        I saved the file somewhere safe and offline. Anyone with it controls this wallet
      </label>
      <button type="button" disabled={!saved || !downloaded} className={`${primary} w-fit`} onClick={recoverySaved}>
        Done
      </button>
    </div>
  );
}

function CodeInput({ id, value, onChange, sentTo }: { id: string; value: string; onChange: (v: string) => void; sentTo: string | null }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-text-2">Code sent to {sentTo}</label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className={`${input} mt-2 font-mono tracking-[0.3em] tabular-nums`}
      />
    </div>
  );
}

function Unlock({ twoFa }: { twoFa: boolean }) {
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await unlockWallet(pw, sentTo ? code : undefined);
          setPw("");
          void refreshBalance();
        } catch (err) {
          if (err instanceof WalletError && err.status === 428) {
            try {
              setSentTo(await sendWalletCode());
            } catch (e2) {
              setError(message(e2));
            }
          } else setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Header title="Unlock your Kixo wallet" sub={twoFa ? "Your wallet password, and a code from your email because 2FA is on" : "Enter your wallet password. It stays unlocked until you close this tab"} />
      <div className="grid gap-3">
        <div>
          <label htmlFor="kw-unlock" className="text-xs text-text-2">Wallet password</label>
          <input id="kw-unlock" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className={`${input} mt-2`} />
        </div>
        {sentTo && <CodeInput id="kw-code" value={code} onChange={setCode} sentTo={sentTo} />}
      </div>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !pw || (!!sentTo && code.length !== 6)} className={primary}>
          {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
          Unlock
        </button>
        {sentTo && (
          <button type="button" disabled={busy} onClick={() => sendWalletCode().then(setSentTo).catch((e) => setError(message(e)))} className="text-xs text-text-2 hover:text-text">
            Send a new code
          </button>
        )}
      </div>
    </form>
  );
}

function Open({ address, twoFa, deposits }: { address: string; twoFa: boolean; deposits: boolean }) {
  const sol = useKixoBalance();
  const port = usePortfolio(address);
  const solUsd = port.data?.sol_usd ?? null;
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [more, setMore] = useState<null | "twofa" | "recovery" | "promo">(null);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-text-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden="true" />
            Kixo wallet
            <CopyChip value={address} />
          </p>
          <p className="mt-2 font-mono text-[28px] leading-none tabular-nums text-text">
            {sol === null ? "…" : fmtSol(sol)}
            <span className="ml-2 font-sans text-sm text-text-2">SOL</span>
          </p>
          <p className="mt-1.5 text-xs tabular-nums text-muted">{sol !== null && solUsd ? `≈ ${(sol * solUsd).toLocaleString("en-US", { style: "currency", currency: "USD" })}` : " "}</p>
        </div>
        <button type="button" onClick={lockWallet} aria-label="Lock wallet" title="Lock the wallet on this device" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
          <Lock size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div role="tablist" aria-label="Move SOL" className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
        {(["deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm capitalize transition-colors ${tab === t ? "bg-surface-2 text-text shadow-[inset_0_0_0_1px_var(--mx-border)]" : "text-text-2 hover:text-text"}`}
          >
            {t === "deposit" ? <ArrowDownToLine size={14} strokeWidth={1.5} /> : <ArrowUpFromLine size={14} strokeWidth={1.5} />}
            {t}
          </button>
        ))}
      </div>
      {tab === "deposit" ? <Deposit address={address} open={deposits} /> : <Withdraw balance={sol} />}

      <div className="flex items-center gap-4 border-t border-border pt-3 text-xs">
        <button type="button" className="flex items-center gap-1.5 text-text-2 hover:text-text" onClick={() => setMore(more === "recovery" ? null : "recovery")}>
          <Download size={14} strokeWidth={1.5} />
          Recovery file
        </button>
        <button type="button" className="flex items-center gap-1.5 text-text-2 hover:text-text" onClick={() => setMore(more === "twofa" ? null : "twofa")}>
          <ShieldCheck size={14} strokeWidth={1.5} className={twoFa ? "text-emerald" : ""} />
          2FA {twoFa ? "on" : "off"}
        </button>
        <button type="button" className="flex items-center gap-1.5 text-text-2 hover:text-text" onClick={() => setMore(more === "promo" ? null : "promo")}>
          <Ticket size={14} strokeWidth={1.5} />
          Promo code
        </button>
      </div>
      {more === "twofa" && <TwoFa on={twoFa} onDone={() => setMore(null)} />}
      {more === "promo" && <PromoBox />}
      {more === "recovery" && <ExportRecovery onDone={() => setMore(null)} />}
    </div>
  );
}

/** A short address that copies the full one. */
function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy address"
      className="flex items-center gap-1 font-mono text-text-2 hover:text-text"
    >
      {shortAddress(value)}
      {copied ? <Check size={12} strokeWidth={1.5} className="text-emerald" /> : <Copy size={12} strokeWidth={1.5} />}
    </button>
  );
}

const QUICK = [0.1, 0.5, 1];

/** What arrives and Kixo's fee, for a deposit or withdrawal of `amount` SOL. */
function FeeLines({ amount, arrives, bps }: { amount: number; arrives: string; bps: number }) {
  const fee = (amount * bps) / 10_000;
  return (
    <dl className="flex flex-col gap-1 rounded-lg bg-bg px-3 py-2 text-xs">
      <div className="flex justify-between">
        <dt className="text-text-2">{arrives}</dt>
        <dd className="font-mono tabular-nums text-text">{fmtSol(amount - fee)} SOL</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted">Kixo fee {bps / 100}%</dt>
        <dd className="font-mono tabular-nums text-muted">{fmtSol(fee)} SOL</dd>
      </div>
    </dl>
  );
}

/** A large amount field with a SOL suffix and optional action on the right. */
function AmountField({ id, value, onChange, right }: { id: string; value: string; onChange: (v: string) => void; right?: React.ReactNode }) {
  return (
    <div className="flex h-12 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className="min-w-0 flex-1 bg-transparent font-mono text-lg tabular-nums text-text outline-none placeholder:text-muted" />
      <span className="text-xs text-muted">SOL</span>
      {right}
    </div>
  );
}

function Deposit({ address, open }: { address: string; open: boolean }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddress, setShowAddress] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!open) return <p className="text-sm text-text-2">Deposits are paused for a short while. Withdrawals stay open</p>;
  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= 0.001 && value <= 100;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const sig = await depositFromPhantom(value);
          pushToast({ tone: "info", title: "Deposit sent", body: "Waiting for Solana to confirm it" });
          setAmount("");
          const s = await waitForTransfer(sig);
          void refreshBalance();
          const credited = value - (value * depositFeeBps()) / 10_000;
          pushToast(
            s === "confirmed"
              ? { tone: "good", title: `${fmtSol(credited)} SOL added to your Kixo wallet` }
              : s === "failed"
                ? { tone: "bad", title: "Deposit failed on chain", body: "Only the network fee left Phantom" }
                : { tone: "bad", title: "Deposit not confirmed yet", body: "Check your balance in a minute" },
          );
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="kw-dep" className="text-xs text-text-2">Amount</label>
      <AmountField id="kw-dep" value={amount} onChange={setAmount} />
      <div className="grid grid-cols-3 gap-2">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => setAmount(String(q))} className={`h-8 rounded-md border font-mono text-xs tabular-nums transition-colors ${Number(amount) === q ? "border-emerald/50 bg-emerald/5 text-text" : "border-border text-text-2 hover:bg-surface-2 hover:text-text"}`}>
            {q} SOL
          </button>
        ))}
      </div>
      {valid && depositFeeBps() > 0 && <FeeLines amount={value} arrives="Arrives in your Kixo wallet" bps={depositFeeBps()} />}
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <button type="submit" disabled={busy || !valid} className={`${primary} h-11 w-full`}>
        {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <ArrowDownToLine size={16} strokeWidth={1.5} />}
        {valid ? `Deposit ${value} SOL from Phantom` : "Deposit from Phantom"}
      </button>
      <p className="text-center text-xs text-muted">Phantom opens with this exact amount. You approve it there</p>

      <div className="mt-1 rounded-lg border border-border">
        <button type="button" onClick={() => setShowAddress((v) => !v)} aria-expanded={showAddress} className="flex h-10 w-full items-center justify-between px-3 text-xs text-text-2 hover:text-text">
          From an exchange or another wallet
          <span className="text-muted">{showAddress ? "Hide" : "Show address"}</span>
        </button>
        {showAddress && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-text">{address}</span>
            <button
              type="button"
              aria-label="Copy address"
              onClick={() => {
                void navigator.clipboard.writeText(address).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text"
            >
              {copied ? <Check size={14} strokeWidth={1.5} className="text-emerald" /> : <Copy size={14} strokeWidth={1.5} />}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

function Withdraw({ balance }: { balance: number | null }) {
  const ph = usePhantomAddress();
  const [route, setRoute] = useState<"phantom" | "address">("phantom");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);
  const dest = route === "address" ? to.trim() : ph;
  const addressOk = !!dest && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(dest);
  const amountOk = max || (Number.isFinite(value) && value > 0);
  const label = max ? "Withdraw all" : amountOk ? `Withdraw ${value} SOL` : "Withdraw";

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      await connectPhantom();
    } catch (err) {
      setError(message(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!dest) return;
        setBusy(true);
        setError(null);
        try {
          const r = await withdrawSol(dest, max ? "max" : value);
          pushToast({ tone: "info", title: "Withdrawal sent", body: "Waiting for Solana to confirm it" });
          setAmount("");
          setMax(false);
          const s = await waitForTransfer(r.signature);
          void refreshBalance();
          pushToast(
            s === "confirmed"
              ? { tone: "good", title: `${fmtSol(r.lamports / 1e9)} SOL sent`, body: r.fee ? `Kixo fee ${fmtSol(r.fee / 1e9)} SOL` : undefined }
              : s === "failed"
                ? { tone: "bad", title: "Withdrawal failed on chain", body: "Your SOL is still in the Kixo wallet, minus the network fee" }
                : { tone: "bad", title: "Withdrawal not confirmed yet", body: "Check your balance in a minute" },
          );
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="kw-amount" className="flex justify-between text-xs text-text-2">
        Amount
        {balance !== null && (
          <button type="button" onClick={() => setMax(true)} className="text-muted hover:text-text">
            Balance <span className="font-mono tabular-nums">{fmtSol(balance)}</span> SOL
          </button>
        )}
      </label>
      <AmountField
        id="kw-amount"
        value={max ? "All" : amount}
        onChange={(v) => {
          setMax(false);
          setAmount(v);
        }}
        right={
          <button type="button" onClick={() => setMax((m) => !m)} aria-pressed={max} className={`h-7 rounded-md px-2 text-xs transition-colors ${max ? "bg-surface-3 text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}>
            Max
          </button>
        }
      />

      <p className="mt-1 text-xs text-text-2">Send to</p>
      <div role="radiogroup" aria-label="Send to" className="grid grid-cols-2 gap-2">
        {(
          [
            ["phantom", "Phantom wallet", Wallet],
            ["address", "Paste address", ClipboardPaste],
          ] as const
        ).map(([key, text, Icon]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={route === key}
            onClick={() => {
              setRoute(key);
              setError(null);
            }}
            className={`flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors ${route === key ? "border-emerald/50 bg-emerald/5 text-text" : "border-border text-text-2 hover:bg-surface-2 hover:text-text"}`}
          >
            <Icon size={14} strokeWidth={1.5} />
            {text}
          </button>
        ))}
      </div>

      {route === "phantom" ? (
        ph ? (
          <div className="flex h-11 items-center justify-between rounded-lg border border-border bg-bg px-3 text-sm">
            <span className="flex items-center gap-2 text-text-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden="true" />
              Connected
            </span>
            <span className="font-mono text-xs text-text">{shortAddress(ph)}</span>
          </div>
        ) : (
          <button type="button" disabled={connecting} onClick={connect} className="flex h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50">
            {connecting ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <Wallet size={14} strokeWidth={1.5} />}
            Connect Phantom to receive
          </button>
        )
      ) : (
        <div className="flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <input aria-label="Solana address" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Paste a Solana address" spellCheck={false} className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text outline-none placeholder:font-sans placeholder:text-muted" />
          <button
            type="button"
            onClick={() => navigator.clipboard.readText().then((t) => setTo(t.trim())).catch(() => {})}
            className="h-7 rounded-md px-2 text-xs text-text-2 hover:bg-surface-2 hover:text-text"
          >
            Paste
          </button>
        </div>
      )}
      {route === "address" && to.trim() && !addressOk && <p className="text-xs text-warning">That does not look like a Solana address</p>}
      {amountOk && (max ? balance !== null && balance > 0 : true) && <FeeLines amount={max ? Math.max(0, (balance ?? 0) - 0.000005) : value} arrives="Arrives at the address" bps={withdrawFeeBps()} />}

      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <button type="submit" disabled={busy || !addressOk || !amountOk} className={`${primary} h-11 w-full`}>
        {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <ArrowUpFromLine size={16} strokeWidth={1.5} />}
        {label}
      </button>
      <p className="text-center text-xs text-muted">Network fee about 0.000005 SOL. Transfers cannot be undone</p>
    </form>
  );
}

function ExportRecovery({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-bg/60 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await exportRecovery(pw, sentTo ? code : undefined);
          setPw("");
          onDone();
        } catch (err) {
          if (err instanceof WalletError && err.status === 428) {
            try {
              setSentTo(await sendWalletCode());
            } catch (e2) {
              setError(message(e2));
            }
          } else setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-text-2">Your wallet password opens the key here in the browser and saves it as a file. Keep it offline</p>
      <div>
        <label htmlFor="kw-export" className="text-xs text-text-2">Wallet password</label>
        <input id="kw-export" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className={`${input} mt-2`} />
      </div>
      {sentTo && <CodeInput id="kw-export-code" value={code} onChange={setCode} sentTo={sentTo} />}
      <button type="submit" disabled={busy || !pw || (!!sentTo && code.length !== 6)} className={`${primary} w-fit`}>
        {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
        Download
      </button>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
    </form>
  );
}

function TwoFa({ on, onDone }: { on: boolean; onDone: () => void }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg/60 p-3">
      <p className="text-sm text-text-2">
        {on ? "2FA is on: a new device needs a code from your email before it can unlock the wallet" : "Turn on 2FA so a new device needs a code from your email as well as your wallet password"}
      </p>
      {!sentTo ? (
        <button
          type="button"
          disabled={busy}
          className={`${quiet} w-fit`}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setSentTo(await sendWalletCode());
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
          Email me a code to turn it {on ? "off" : "on"}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <CodeInput id="kw-2fa" value={code} onChange={setCode} sentTo={sentTo} />
          <button
            type="button"
            disabled={busy || code.length !== 6}
            className={`${primary} w-fit`}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await setTwoFa(!on, code);
                pushToast({ tone: "good", title: `2FA turned ${on ? "off" : "on"}` });
                onDone();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Turn {on ? "off" : "on"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
    </div>
  );
}

/** Apply a promo code; shows the one in use and the fees it gives. */
function PromoBox() {
  const [p, setP] = useState<PromoState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getPromo().then(setP, () => {});
  }, []);
  const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-bg/60 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setP(await redeemPromo(code));
          setCode("");
          void refreshWallet();
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {p?.promo ? (
        <p className="text-sm text-text-2">
          <span className="font-mono text-emerald">{p.promo.code}</span> is active: trade fee {pct(p.trade_fee_bps)}, withdrawal fee {pct(p.withdraw_fee_bps)}
          {p.promo.until ? ` until ${new Date(p.promo.until * 1000).toLocaleDateString()}` : ""}
        </p>
      ) : (
        <p className="text-sm text-text-2">Have a code from Kixo or a creator? It lowers your fees</p>
      )}
      <div className="flex gap-2">
        <input aria-label="Promo code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20))} placeholder="CODE" className={`${input} font-mono uppercase`} />
        <button type="submit" disabled={busy || code.length < 3} className={primary}>
          {busy && <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />}
          Apply
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
    </form>
  );
}
