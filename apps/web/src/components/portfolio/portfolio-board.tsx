"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, RefreshCw, Wallet } from "lucide-react";
import { activeWallet, authError, connectWallet, useAccount } from "@/lib/account";
import { pct, price, sol as fmtSol, usd } from "@/lib/gateway";
import { pnlByCoin, useActivity, usePortfolio, type CoinPnl, type Holding, type Trade } from "@/lib/portfolio";
import { pnl as sniperPnl, useSniper } from "@/lib/sniper";
import { pushToast } from "@/lib/toast";
import { CopyAddress, TokenLogo } from "@/components/token/token-bits";
import { useMode } from "@/lib/demo";
import { DemoPortfolio } from "./demo-portfolio";

const SMALL_USD = 1;
/** Allocation colors: SOL leads in the accent, holdings in neutral steps. */
const SHADES = ["var(--mx-emerald)", "#d4d4d8", "#a1a1aa", "#71717a", "#52525b", "#3f3f46"];

export function PortfolioBoard() {
  const account = useAccount();
  const viewing = useSearchParams().get("wallet");
  // Any wallet can be viewed read-only (from Smart Money or by address).
  const other = viewing && isAddress(viewing) ? viewing : null;
  const mode = useMode();
  const wallet = other ?? activeWallet(account);
  if (mode === "demo" && !other) return <DemoPortfolio />;
  if (!wallet) return <ConnectFirst />;
  return <Board key={wallet} wallet={wallet} viewing={!!other && other !== activeWallet(account)} />;
}

function Board({ wallet, viewing }: { wallet: string; viewing: boolean }) {
  const port = usePortfolio(wallet);
  const act = useActivity(wallet);
  const [hideSmall, setHideSmall] = useState(true);
  const p = port.data;
  const solUsd = p?.sol_usd ?? null;

  const tokens = useMemo(() => p?.tokens ?? [], [p]);
  const tokensUsd = tokens.reduce((s, t) => s + (t.value_usd ?? 0), 0);
  const solValue = p && solUsd ? p.sol * solUsd : null;
  const total = solValue != null ? solValue + tokensUsd : null;
  const coins = useMemo(() => pnlByCoin(act.data ?? [], tokens, solUsd), [act.data, tokens, solUsd]);
  const realized = [...coins.values()].reduce((s, c) => s + c.realizedSol, 0);
  const unrealizedList = [...coins.values()].map((c) => c.unrealizedSol).filter((x): x is number => x != null);
  const unrealized = unrealizedList.length ? unrealizedList.reduce((a, b) => a + b, 0) : null;

  const shown = tokens.filter((t) => !hideSmall || (t.value_usd ?? 0) >= SMALL_USD);
  const hidden = tokens.length - shown.length;
  const symbolOf = (mint: string) => tokens.find((t) => t.mint === mint)?.symbol || `${mint.slice(0, 4)}…`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-text">{viewing ? "Wallet portfolio" : "Portfolio"}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-text-2">
            <CopyAddress value={wallet} className="text-cyan text-xs" />
            {p && <span className="text-xs text-muted">Updated {new Date(p.updated * 1000).toLocaleTimeString()}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => { port.reload(); act.reload(); }}
          className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <RefreshCw size={14} strokeWidth={1.5} className={port.loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {port.error && !p && <Notice>{port.error}</Notice>}

      {/* Key figures */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <Stat label="Total value" big value={total != null ? usdFull(total) : p ? "—" : null} sub={total != null && solUsd ? `${(total / solUsd).toFixed(2)} SOL` : undefined} />
        <Stat label="SOL balance" value={p ? `${p.sol.toFixed(3)} SOL` : null} sub={solValue != null ? usdFull(solValue) : undefined} />
        <Stat
          label="Realized P&L"
          value={act.data ? signedSol(realized) : null}
          tone={realized}
          sub={act.data && solUsd ? `${signedUsd(realized * solUsd)} · last 30 days` : "last 30 days"}
        />
        <Stat
          label="Unrealized P&L"
          value={act.data && p ? (unrealized != null ? signedSol(unrealized) : "—") : null}
          tone={unrealized ?? 0}
          sub={unrealized != null && solUsd ? `${signedUsd(unrealized * solUsd)} on open coins` : "needs buys in the window"}
        />
      </section>

      {p && total != null && total > 0 && <Allocation tokens={tokens} solValue={solValue ?? 0} total={total} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Holdings */}
        <section className="min-w-0 rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-text">
              Holdings <span className="ml-1 font-mono text-xs text-muted">{tokens.length}</span>
            </h2>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
              <input type="checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} className="accent-emerald" />
              Hide under $1{hideSmall && hidden > 0 ? ` (${hidden})` : ""}
            </label>
          </div>
          {!p ? (
            <Loading />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="px-4 py-2 font-normal">Token</th>
                    <th className="px-3 py-2 text-right font-normal">Balance</th>
                    <th className="px-3 py-2 text-right font-normal">Price</th>
                    <th className="px-3 py-2 text-right font-normal">24h</th>
                    <th className="px-3 py-2 text-right font-normal">Value</th>
                    <th className="px-3 py-2 text-right font-normal">Share</th>
                    <th className="px-3 py-2 text-right font-normal">P&L</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <SolRow sol={p.sol} solUsd={solUsd} total={total} />
                  {shown.map((t) => (
                    <HoldingRow key={t.mint} t={t} total={total} pnl={coins.get(t.mint)} />
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <p className="px-4 py-6 text-sm text-text-2">No tokens{hidden ? " above $1" : ""} in this wallet</p>}
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <Activity trades={act.data} error={act.error} symbolOf={symbolOf} solUsd={solUsd} />
          {!viewing && <PaperSniper />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Pieces ---------------- */

function Stat({ label, value, sub, big, tone }: { label: string; value: string | null; sub?: string; big?: boolean; tone?: number }) {
  const color = tone == null || tone === 0 ? "text-text" : tone > 0 ? "text-positive" : "text-negative";
  return (
    <div className="bg-surface px-4 py-4">
      <div className="text-xs text-text-2">{label}</div>
      {value == null ? (
        <div className={`mt-2 animate-pulse rounded bg-surface-3 ${big ? "h-8 w-40" : "h-6 w-24"}`} />
      ) : (
        <div className={`mt-1 font-medium tabular-nums ${big ? "text-3xl text-text" : `text-xl ${color}`}`}>{value}</div>
      )}
      {sub && <div className="mt-1 text-xs text-muted tabular-nums">{sub}</div>}
    </div>
  );
}

function Allocation({ tokens, solValue, total }: { tokens: Holding[]; solValue: number; total: number }) {
  const parts = [{ label: "SOL", value: solValue }, ...tokens.filter((t) => (t.value_usd ?? 0) > 0).map((t) => ({ label: t.symbol || t.mint.slice(0, 4), value: t.value_usd ?? 0 }))].sort((a, b) => b.value - a.value);
  const top = parts.slice(0, 5);
  const rest = parts.slice(5).reduce((s, x) => s + x.value, 0);
  if (rest > 0) top.push({ label: "Other", value: rest });
  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-4">
      <h2 className="text-sm font-medium text-text">Allocation</h2>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-3">
        {top.map((x, i) => (
          <div key={x.label} style={{ width: `${(x.value / total) * 100}%`, background: SHADES[i] }} className="h-full border-r border-surface last:border-r-0" title={`${x.label} ${((x.value / total) * 100).toFixed(1)}%`} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {top.map((x, i) => (
          <li key={x.label} className="flex items-center gap-2 text-text-2">
            <span className="h-2 w-2 rounded-full" style={{ background: SHADES[i] }} />
            <span className="text-text">{x.label}</span>
            <span className="font-mono tabular-nums text-muted">{((x.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SolRow({ sol, solUsd, total }: { sol: number; solUsd: number | null; total: number | null }) {
  const value = solUsd ? sol * solUsd : null;
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-3 font-mono text-[11px] text-emerald">SOL</span>
          <div>
            <div className="text-text">Solana</div>
            <div className="text-xs text-muted">Native balance</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right text-text">{sol.toFixed(4)}</td>
      <td className="px-3 py-2.5 text-right text-text-2">{price(solUsd)}</td>
      <td className="px-3 py-2.5 text-right text-muted">—</td>
      <td className="px-3 py-2.5 text-right text-text">{usdFull(value)}</td>
      <td className="px-3 py-2.5 text-right text-text-2">{value != null && total ? `${((value / total) * 100).toFixed(1)}%` : "—"}</td>
      <td className="px-3 py-2.5 text-right text-muted">—</td>
      <td className="px-4 py-2.5" />
    </tr>
  );
}

function HoldingRow({ t, total, pnl }: { t: Holding; total: number | null; pnl?: CoinPnl }) {
  const coinPnl = pnl ? pnl.realizedSol + (pnl.unrealizedSol ?? 0) : null;
  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-4 py-2.5">
        <Link href={`/token/${t.mint}`} className="flex min-w-0 items-center gap-3">
          <TokenLogo src={t.image} symbol={t.symbol || "?"} size={32} />
          <div className="min-w-0">
            <div className="truncate text-text">{t.symbol || "Unknown"}</div>
            <div className="max-w-44 truncate text-xs text-muted">{t.name || `${t.mint.slice(0, 6)}…`}</div>
          </div>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-right text-text">{compact(t.amount)}</td>
      <td className="px-3 py-2.5 text-right text-text-2">{price(t.price_usd)}</td>
      <td className={`px-3 py-2.5 text-right ${tone(t.change_24h)}`}>{pct(t.change_24h)}</td>
      <td className="px-3 py-2.5 text-right text-text">{t.value_usd == null ? <span className="text-muted">No price</span> : usdFull(t.value_usd)}</td>
      <td className="px-3 py-2.5 text-right text-text-2">{t.value_usd != null && total ? `${((t.value_usd / total) * 100).toFixed(1)}%` : "—"}</td>
      <td className={`px-3 py-2.5 text-right ${tone(coinPnl)}`} title={pnl ? `Bought ${pnl.boughtSol.toFixed(3)} SOL, sold ${pnl.soldSol.toFixed(3)} SOL in the last 30 days` : "No buys in the last 30 days"}>
        {coinPnl == null ? "—" : signedSol(coinPnl)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link href={`/token/${t.mint}`} className="rounded-md border border-border px-2.5 py-1 text-xs text-text-2 transition-colors hover:bg-surface-3 hover:text-text">
          Trade
        </Link>
      </td>
    </tr>
  );
}

const ACTIVITY_PAGE = 50;

function Activity({ trades, error, symbolOf, solUsd }: { trades: Trade[] | null; error: string | null; symbolOf: (m: string) => string; solUsd: number | null }) {
  const [shown, setShown] = useState(ACTIVITY_PAGE);
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">
          Trades <span className="font-normal text-muted">· last 30 days</span>
        </h2>
        {trades && <span className="font-mono text-xs text-muted">{trades.length}</span>}
      </div>
      {!trades ? (
        error ? <p className="px-4 py-4 text-sm text-text-2">{error}</p> : <Loading />
      ) : trades.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-2">No swaps in this wallet in the last 30 days</p>
      ) : (
        <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
          {trades.slice(0, shown).map((t) => (
            <li key={t.sig + t.mint}>
              <Link href={`/token/${t.mint}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2">
                <span className={`w-9 text-xs font-medium ${t.buy ? "text-positive" : "text-negative"}`}>{t.buy ? "Buy" : "Sell"}</span>
                <span className="min-w-0 flex-1 truncate text-text">{t.symbol || symbolOf(t.mint)}</span>
                <span className="text-right tabular-nums">
                  <span className="block text-text">{t.sol.toFixed(3)} SOL</span>
                  <span className="block text-xs text-muted">{solUsd ? usd(t.sol * solUsd) : ""} · {ago(t.time)}</span>
                </span>
              </Link>
            </li>
          ))}
          {trades.length > shown && (
            <li>
              <button type="button" onClick={() => setShown((n) => n + ACTIVITY_PAGE)} className="w-full px-4 py-2.5 text-center text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
                Show {Math.min(ACTIVITY_PAGE, trades.length - shown)} more of {trades.length - shown}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function PaperSniper() {
  const { positions } = useSniper();
  const closed = positions.filter((p) => p.exitTs);
  const open = positions.length - closed.length;
  const results = closed.map((p) => sniperPnl(p, null).sol ?? 0);
  const total = results.reduce((a, b) => a + b, 0);
  const wins = results.filter((x) => x > 0).length;
  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Paper sniper</h2>
        <Link href="/sniper" className="text-xs text-text-2 hover:text-text">Open</Link>
      </div>
      <p className="mt-1 text-xs text-muted">Simulated trades, not part of the wallet</p>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm tabular-nums">
        <div>
          <dt className="text-xs text-text-2">Result</dt>
          <dd className={`mt-1 ${tone(total)}`}>{closed.length ? fmtSol(total) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-2">Win rate</dt>
          <dd className="mt-1 text-text">{closed.length ? `${Math.round((wins / closed.length) * 100)}%` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-2">Open</dt>
          <dd className="mt-1 text-text">{open}</dd>
        </div>
      </dl>
    </section>
  );
}

function ConnectFirst() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-medium text-text">Portfolio</h1>
      <div className="flex flex-col items-start gap-4 rounded-xl border border-border bg-surface px-6 py-10">
        <Wallet size={20} strokeWidth={1.5} className="text-text-2" />
        <div>
          <h2 className="text-lg font-medium text-text">Connect a wallet to see your portfolio</h2>
          <p className="mt-1 max-w-lg text-sm text-text-2">Balances, live prices, allocation and profit from your own trades, read from the chain. Connecting only shares your address</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await connectWallet();
            } catch (e) {
              pushToast({ tone: "bad", title: "Wallet not connected", body: authError(e) });
            } finally {
              setBusy(false);
            }
          }}
          className="flex h-10 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <Wallet size={16} strokeWidth={1.5} />}
          Connect wallet
        </button>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-sm text-text-2">
      <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
      Reading the chain
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">{children}</p>;
}

/* ---------------- Formatting ---------------- */

const isAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

function usdFull(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 });
}
const signedSol = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(3)} SOL`;
const signedUsd = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${usdFull(Math.abs(v))}`;
const tone = (v: number | null | undefined) => (v == null || v === 0 ? "text-text-2" : v > 0 ? "text-positive" : "text-negative");
function compact(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v >= 1 ? v.toFixed(2) : v.toPrecision(3);
}
function ago(ts: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
