"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell, BellOff, Check, Copy, ExternalLink, Eye, Loader2, Maximize2, RefreshCw, X } from "lucide-react";
import { useWalletLabels, type WalletLabel } from "@/lib/labels";
import { pnlByCoin, useActivity, useLiveTrades, usePortfolio, type Holding, type Trade } from "@/lib/portfolio";
import { useMonitor } from "@/lib/prefs";
import { closeWalletTracker, openWalletTracker, useAddressKind, useOpenWallet, type AddressKind } from "@/lib/tracker";
import { shortAddress } from "@/lib/gateway";
import { useNow } from "@/components/radar/use-radar-feed";
import { TokenLogo } from "@/components/token/token-bits";

/* ---------------- Formatting ---------------- */

const usd = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : digits, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : digits }));
const solFmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 1 : v >= 1 ? 3 : 4 })} SOL`);
const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
const amountFmt = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const priceFmt = (v: number | null) => (v == null ? "—" : v >= 1 ? usd(v) : v >= 0.0001 ? `$${v.toFixed(6)}` : `$${v.toExponential(2)}`);

function ago(ts: number, now: number) {
  if (!now) return "";
  const s = Math.max(0, Math.floor(now / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** A swap row: from the history, or seen live by Kixo (with the coin's image). */
type Swap = Trade & { image?: string | null; live?: boolean };

const WINDOWS = [
  ["1h", 3600],
  ["3h", 3 * 3600],
  ["24h", 86400],
  ["30d", 30 * 86400],
] as const;

/* ---------------- A wallet anywhere on the site ---------------- */

const LABEL_STYLE: Record<WalletLabel, { text: string; tone: string; title: string }> = {
  dev: { text: "Dev", tone: "border-warning/30 text-warning", title: "Created this coin" },
  smart: { text: "Smart", tone: "border-emerald/30 text-emerald", title: "Smart Money: strong realized results across many coins" },
  whale: { text: "Whale", tone: "border-cyan/30 text-cyan", title: "Bought 5 SOL or more at once, or holds 1% or more of the supply" },
  bundler: { text: "Bundler", tone: "border-negative/30 text-negative", title: "Bought in a bundle: 3 or more wallets in the same second at launch, often one person" },
  sniper: { text: "Sniper", tone: "border-negative/30 text-negative", title: "Bought in the first 3 seconds after launch" },
};

/** One wallet label, the same everywhere on the site. */
export function LabelChip({ label }: { label: WalletLabel }) {
  const s = LABEL_STYLE[label];
  return (
    <span title={s.title} className={`rounded border px-1 font-sans text-[10px] leading-4 ${s.tone}`}>
      {s.text}
    </span>
  );
}

/** A wallet address anywhere on the site: its labels (from the coin in scope and Smart
 *  Money), the address (opens the Wallet Tracker), copy, and a Track button. */
export function WalletLink({
  address,
  className = "text-cyan",
  extra = [],
  badges = true,
}: {
  address: string;
  className?: string;
  /** Labels the caller already knows, e.g. a trade row's dev flag. */
  extra?: (WalletLabel | false | undefined)[];
  badges?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const labels = useWalletLabels(address, extra);
  return (
    <span className="inline-flex items-center gap-1">
      {badges && labels.map((l) => <LabelChip key={l} label={l} />)}
      <button
        type="button"
        title={`Open ${address} in the Wallet Tracker`}
        onClick={(e) => {
          e.stopPropagation();
          openWalletTracker(address);
        }}
        className={`font-mono text-xs underline-offset-2 hover:underline ${className}`}
      >
        {shortAddress(address)}
      </button>
      <button
        type="button"
        aria-label={`Copy ${address}`}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="text-muted hover:text-text"
      >
        {copied ? <Check size={11} strokeWidth={1.5} className="text-emerald" /> : <Copy size={11} strokeWidth={1.5} />}
      </button>
      <button
        type="button"
        aria-label={`Track ${address}`}
        title="Track: open this wallet's balance, coins and swaps"
        onClick={(e) => {
          e.stopPropagation();
          openWalletTracker(address);
        }}
        className="flex size-5 items-center justify-center rounded text-muted transition-colors hover:bg-surface-3 hover:text-cyan"
      >
        <Eye size={12} strokeWidth={1.5} />
      </button>
    </span>
  );
}

/** The side panel, opened by any WalletLink. Mounted once in the app layout. */
export function WalletTrackerDrawer() {
  const address = useOpenWallet();
  useEffect(() => {
    if (!address) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeWalletTracker();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [address]);
  if (!address) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Wallet Tracker" className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={closeWalletTracker}>
      <div className="row-in flex h-full w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-2xl shadow-black/60" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-medium text-text">Wallet Tracker</span>
          <span className="flex items-center gap-1">
            <Link href={`/tracker?w=${address}`} onClick={closeWalletTracker} title="Open as a full page" className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-text-2 hover:bg-surface-2 hover:text-text">
              <Maximize2 size={13} strokeWidth={1.5} />
              Full page
            </Link>
            <button type="button" onClick={closeWalletTracker} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text">
              <X size={16} strokeWidth={1.5} />
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WalletTracker key={address} address={address} compact />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- The tracker ---------------- */

/** Checks what the address is first: a coin's address opens the coin instead of an empty
 *  "wallet" with no coins and no swaps. */
export function WalletTracker({ address, compact = false }: { address: string; compact?: boolean }) {
  const kind = useAddressKind(address);
  if (kind === "checking")
    return (
      <div className={`flex items-center gap-2 text-sm text-text-2 ${compact ? "p-4" : ""}`}>
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
        Checking the address
      </div>
    );
  if (kind && kind.kind !== "wallet") return <NotAWallet address={address} k={kind} compact={compact} />;
  return <WalletView address={address} compact={compact} />;
}

function NotAWallet({ address, k, compact }: { address: string; k: AddressKind; compact: boolean }) {
  const symbol = k.symbol?.trim() || shortAddress(address);
  const text =
    k.kind === "coin"
      ? "This is a coin's address, not a wallet. A coin has no balance or swaps of its own: its price, trades and holders are on its page, and every trader and holder there opens here in one click"
      : k.kind === "token_account"
        ? "This is a token account, which holds one coin for a wallet. Paste the owner wallet's address to see everything it holds and trades"
        : "This is a program's address, not a wallet. Programs run trades for wallets but do not hold or trade coins themselves";
  return (
    <div className={`flex flex-col gap-4 ${compact ? "p-4" : ""}`}>
      <div className="rounded-xl border border-border bg-surface p-5">
        {k.kind === "coin" && (
          <div className="mb-4 flex items-center gap-3">
            <TokenLogo src={k.image ?? null} symbol={symbol} size={44} />
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-text">
                {k.symbol ? `$${symbol}` : symbol}
                {k.name && <span className="ml-2 text-sm font-normal text-text-2">{k.name}</span>}
              </p>
              <p className="font-mono text-xs text-text-2">{k.mc_usd != null ? `Market cap ${usd(k.mc_usd, 0)}` : shortAddress(address)}</p>
            </div>
          </div>
        )}
        <p className="max-w-2xl text-sm leading-relaxed text-text-2">{text}</p>
        {k.kind === "coin" && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/token/${address}`} onClick={closeWalletTracker} className="flex h-9 items-center rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90">
              Open {k.symbol ? `$${symbol}` : "the coin"}: trades and holders
            </Link>
            <a href={`https://solscan.io/token/${address}`} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-2 hover:bg-surface-2 hover:text-text">
              Solscan
              <ExternalLink size={13} strokeWidth={1.5} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function WalletView({ address, compact }: { address: string; compact: boolean }) {
  const port = usePortfolio(address);
  const headerLabels = useWalletLabels(address);
  const act = useActivity(address);
  const live = useLiveTrades(address);
  const now = useNow();
  const monitor = useMonitor();
  const tracked = monitor.has(address);
  const [copied, setCopied] = useState(false);
  const [win, setWin] = useState<(typeof WINDOWS)[number][0]>("3h");
  const [dust, setDust] = useState(false);

  const p = port.data;
  const solUsd = p?.sol_usd ?? null;
  const tokens = useMemo(() => (p?.tokens ?? []).slice().sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0)), [p]);
  const trades = useMemo(() => (act.data ?? []).slice().sort((a, b) => b.time - a.time), [act.data]);
  const coins = useMemo(() => pnlByCoin(trades, tokens, solUsd), [trades, tokens, solUsd]);
  // Recent swaps: the on-chain history plus what Kixo saw live (instant), one row per
  // transaction. Live rows show up first while the history is still loading.
  const swaps = useMemo(() => {
    const seen = new Set(trades.map((t) => t.sig + t.mint));
    const fromLive: Swap[] = (live.data ?? [])
      .filter((t) => !seen.has(t.sig + t.mint))
      .map((t) => ({ mint: t.mint, buy: t.buy, sol: t.sol, raw: "0", time: t.time, sig: t.sig, symbol: t.symbol, image: t.image, live: true }));
    return [...fromLive, ...(trades as Swap[])].sort((a, b) => b.time - a.time);
  }, [trades, live.data]);

  const solValue = p && solUsd ? p.sol * solUsd : null;
  const tokensUsd = tokens.reduce((s, t) => s + (t.value_usd ?? 0), 0);
  const total = solValue != null ? solValue + tokensUsd : null;
  const realizedSol = [...coins.values()].reduce((s, c) => s + c.realizedSol, 0);
  const closed = [...coins.values()].filter((c) => c.soldSol > 0 && c.avgCost != null);
  const wins = closed.filter((c) => c.realizedSol > 0).length;
  const lastActive = swaps[0]?.time ?? null;

  const shown = tokens.filter((t) => dust || (t.value_usd ?? 0) >= 1);
  const hidden = tokens.length - shown.length;
  const windowSecs = WINDOWS.find(([k]) => k === win)![1];
  const recent = now ? swaps.filter((t) => Math.floor(now / 1000) - t.time <= windowSecs) : [];

  const loading = port.loading && !p;
  return (
    <div className={`flex flex-col gap-5 ${compact ? "p-4" : ""}`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-text-2">
            Wallet
            {headerLabels.map((l) => (
              <LabelChip key={l} label={l} />
            ))}
          </p>
          <p className="mt-1 flex items-center gap-2 font-mono text-sm text-text">
            <span className="truncate">{compact ? shortAddress(address) : address}</span>
            <button
              type="button"
              aria-label="Copy address"
              onClick={() =>
                navigator.clipboard.writeText(address).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                })
              }
              className="text-muted hover:text-text"
            >
              {copied ? <Check size={13} strokeWidth={1.5} className="text-emerald" /> : <Copy size={13} strokeWidth={1.5} />}
            </button>
            <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer" aria-label="Open on Solscan" className="text-muted hover:text-text">
              <ExternalLink size={13} strokeWidth={1.5} />
            </a>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              port.reload();
              act.reload();
            }}
            aria-label="Refresh"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-2 hover:bg-surface-2 hover:text-text"
          >
            <RefreshCw size={13} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => (tracked ? monitor.remove(address) : monitor.add(address))}
            title={tracked ? "Stop alerts for this wallet" : "Get an alert when this wallet trades (Wallet Monitor)"}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition-colors ${tracked ? "border border-emerald/40 bg-emerald/5 text-text" : "bg-text font-medium text-bg hover:opacity-90"}`}
          >
            {tracked ? <BellOff size={13} strokeWidth={1.5} /> : <Bell size={13} strokeWidth={1.5} />}
            {tracked ? "Tracking" : "Track"}
          </button>
        </div>
      </div>

      {port.error && !p && <p className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">{port.error}</p>}

      {/* Balance */}
      <section className={`grid gap-3 ${compact ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
        <div className={`rounded-xl border border-border bg-bg/40 p-4 ${compact ? "col-span-2" : ""}`}>
          <p className="text-xs text-text-2">Total value</p>
          <p className="mt-1 font-mono text-3xl tabular-nums text-text">{loading ? <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-muted" /> : usd(total)}</p>
          <p className="mt-1 text-xs text-muted">{p ? `${tokens.length} coins · SOL at ${usd(solUsd)}` : "Reading the chain"}</p>
        </div>
        <Stat label="SOL balance" value={solFmt(p?.sol)} sub={usd(solValue)} />
        <Stat label="Coins value" value={usd(tokensUsd)} sub={solUsd ? solFmt(tokensUsd / solUsd) : ""} />
        {!compact && <Stat label="Last active" value={lastActive ? ago(lastActive, now) : act.loading ? "…" : "No swaps in 30 days"} sub={trades.length ? `${trades.length} swaps in 30 days` : ""} />}
      </section>

      {/* 30-day results from its swaps */}
      <section className="grid grid-cols-3 gap-3">
        <Stat label="Realized P&L, 30d" value={act.data ? `${realizedSol >= 0 ? "+" : "−"}${solFmt(Math.abs(realizedSol))}` : "…"} sub={act.data && solUsd ? signedUsd(realizedSol * solUsd) : ""} tone={realizedSol > 0 ? "good" : realizedSol < 0 ? "bad" : undefined} />
        <Stat label="Win rate" value={closed.length ? `${Math.round((wins / closed.length) * 100)}%` : "—"} sub={closed.length ? `${wins} of ${closed.length} coins sold in profit` : "No sales seen"} />
        <Stat label="Swaps, 30d" value={act.data ? String(trades.length) : "…"} sub={act.data ? `${trades.filter((t) => t.buy).length} buys · ${trades.filter((t) => !t.buy).length} sells` : ""} />
      </section>

      {/* Holdings */}
      <section className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-medium text-text">
            Holdings <span className="font-mono text-xs text-muted">{tokens.length}</span>
          </h3>
          {hidden > 0 || dust ? (
            <button type="button" onClick={() => setDust((d) => !d)} className="text-xs text-text-2 hover:text-text">
              {dust ? "Hide under $1" : `Show ${hidden} under $1`}
            </button>
          ) : null}
        </div>
        {loading ? (
          <p className="flex items-center gap-2 px-4 py-6 text-xs text-text-2">
            <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
            Reading the chain
          </p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-2">{tokens.length ? "Only small balances under $1" : "No coins in this wallet"}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((t) => (
              <HoldingRow key={t.mint} t={t} share={total ? ((t.value_usd ?? 0) / total) * 100 : 0} pnlSol={coins.get(t.mint)?.unrealizedSol ?? null} solUsd={solUsd} />
            ))}
          </ul>
        )}
      </section>

      {/* Recent transactions */}
      <section className="overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-medium text-text">Recent swaps</h3>
          <div role="tablist" aria-label="Time window" className="flex gap-1 rounded-lg bg-bg p-0.5">
            {WINDOWS.map(([k]) => (
              <button key={k} type="button" role="tab" aria-selected={win === k} onClick={() => setWin(k)} className={`h-7 rounded-md px-2.5 font-mono text-xs transition-colors ${win === k ? "bg-surface-2 text-text" : "text-text-2 hover:text-text"}`}>
                {k}
              </button>
            ))}
          </div>
        </div>
        {act.loading && !act.data && recent.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-xs text-text-2">
            <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
            Reading its transactions
          </p>
        ) : act.error && !act.data && recent.length === 0 ? (
          <p className="px-4 py-6 text-xs text-warning">{act.error}</p>
        ) : recent.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-2">No swaps in the last {win}{trades.length && lastActive ? `. Last one ${ago(lastActive, now)}` : ""}</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.slice(0, 100).map((t) => (
              <SwapRow key={t.sig + t.mint} t={t} solUsd={solUsd} now={now} image={(t as Swap).image ?? tokens.find((h) => h.mint === t.mint)?.image ?? null} />
            ))}
            {act.loading && !act.data && (
              <li className="flex items-center gap-2 px-4 py-2.5 text-[11px] text-muted">
                <Loader2 size={11} strokeWidth={1.5} className="animate-spin" />
                Loading older swaps from the chain
              </li>
            )}
          </ul>
        )}
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted">Updates every 5 seconds from Kixo&apos;s live feed, plus the wallet&apos;s on-chain history. Dollar amounts use today&apos;s SOL price</p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-border bg-bg/40 p-3">
      <p className="text-[11px] text-text-2">{label}</p>
      <p className={`mt-1 font-mono text-base tabular-nums ${tone === "good" ? "text-positive" : tone === "bad" ? "text-negative" : "text-text"}`}>{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}

function HoldingRow({ t, share, pnlSol, solUsd }: { t: Holding; share: number; pnlSol: number | null; solUsd: number | null }) {
  const pnl = pnlSol != null && solUsd ? pnlSol * solUsd : null;
  return (
    <li>
      <Link href={`/token/${t.mint}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        <TokenLogo src={t.image} symbol={t.symbol || "?"} size={28} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm text-text">{t.symbol || shortAddress(t.mint)}</span>
            {t.change_24h != null && <span className={`font-mono text-[11px] tabular-nums ${t.change_24h >= 0 ? "text-positive" : "text-negative"}`}>{t.change_24h >= 0 ? "+" : ""}{t.change_24h.toFixed(1)}%</span>}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full bg-emerald/70" style={{ width: `${Math.min(100, Math.max(2, share))}%` }} />
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted">{amountFmt(t.amount)} · {priceFmt(t.price_usd)}</span>
          </span>
        </span>
        <span className="text-right">
          <span className="block font-mono text-sm tabular-nums text-text">{usd(t.value_usd)}</span>
          <span className={`block font-mono text-[11px] tabular-nums ${pnl == null ? "text-muted" : pnl >= 0 ? "text-positive" : "text-negative"}`}>{pnl == null ? `${share.toFixed(1)}%` : signedUsd(pnl)}</span>
        </span>
      </Link>
    </li>
  );
}

function SwapRow({ t, solUsd, now, image }: { t: Trade; solUsd: number | null; now: number; image: string | null }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className={`w-10 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium ${t.buy ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"}`}>{t.buy ? "Buy" : "Sell"}</span>
      <TokenLogo src={image} symbol={t.symbol || "?"} size={22} />
      <Link href={`/token/${t.mint}`} className="min-w-0 flex-1 truncate text-sm text-text hover:underline">
        {t.symbol || shortAddress(t.mint)}
      </Link>
      <span className="text-right">
        <span className="block font-mono text-sm tabular-nums text-text">{solFmt(t.sol)}</span>
        <span className="block font-mono text-[11px] tabular-nums text-muted">{solUsd ? usd(t.sol * solUsd) : ""}</span>
      </span>
      <span className="w-20 shrink-0 text-right text-[11px] text-text-2">{ago(t.time, now)}</span>
      <a href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noopener noreferrer" aria-label="Open the transaction on Solscan" className="text-muted hover:text-text">
        <ExternalLink size={12} strokeWidth={1.5} />
      </a>
    </li>
  );
}
