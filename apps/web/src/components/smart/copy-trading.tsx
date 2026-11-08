"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Copy as CopyIcon, Pause, Play, Trash2, X } from "lucide-react";
import { addCopy, DEFAULT_RULES, exitLiquidity, promoteBlock, promoteCopy, removeCopy, updateCopy, useCopies, type Copy, type CopyRules } from "@/lib/copy";
import { useFeatures } from "@/lib/features";
import { useVenue } from "@/lib/execute";
import { shortAddress } from "@/lib/gateway";
import { pushToast } from "@/lib/toast";
import { WalletLink } from "@/components/tracker/wallet-tracker";

export type CopyLeader = { wallet: string; coins: number; win_rate: number; realized_sol: number; copy_coins: number; copy_return_pct: number | null };

const money = (venue: Copy["venue"], v: number) => (venue === "demo" ? `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}` : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(4)} SOL`);

/** The backtest line: what copying this wallet 3 seconds late made, fees included. */
function Backtest({ l }: { l: CopyLeader }) {
  const exit = exitLiquidity(l.realized_sol, l.copy_return_pct);
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs leading-5 ${exit ? "border-negative/30 bg-negative/5" : "border-border"}`}>
      {l.copy_return_pct == null ? (
        <span className="text-text-2">Backtest: not enough copied coins yet ({l.copy_coins} of 3)</span>
      ) : (
        <span className="text-text-2">
          Backtest: copying it 3 s late, with fees, made{" "}
          <span className={`font-mono ${l.copy_return_pct >= 0 ? "text-positive" : "text-negative"}`}>
            {l.copy_return_pct >= 0 ? "+" : ""}
            {l.copy_return_pct.toFixed(1)}%
          </span>{" "}
          over {l.copy_coins} coins
        </span>
      )}
      {exit && <span className="mt-1 block text-negative">It wins but its copiers lose: it tends to sell into the people following it</span>}
    </div>
  );
}

/** "Copy" on a Smart Money wallet: opens the copy settings. */
export function CopyButton({ leader }: { leader: CopyLeader }) {
  const on = useFeatures().copy_trading;
  const copies = useCopies();
  const [open, setOpen] = useState(false);
  if (!on) return null;
  const copying = copies.some((c) => c.leader === leader.wallet && c.status === "running");
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${copying ? "border-emerald/30 text-emerald" : "border-border text-text-2 hover:bg-surface-3 hover:text-text"}`}
      >
        <CopyIcon size={11} strokeWidth={1.5} />
        {copying ? "Copying" : "Copy"}
      </button>
      {open && typeof document !== "undefined" && createPortal(<CopyDialog leader={leader} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function CopyDialog({ leader, onClose }: { leader: CopyLeader; onClose: () => void }) {
  const { venue, why } = useVenue();
  const [r, setR] = useState<CopyRules>(DEFAULT_RULES);
  const set = (p: Partial<CopyRules>) => setR((x) => ({ ...x, ...p }));
  const exit = exitLiquidity(leader.realized_sol, leader.copy_return_pct);

  function start() {
    const err = addCopy(leader.wallet, "demo", r);
    if (err) return pushToast({ tone: "bad", title: "Copy not started", body: err });
    pushToast({ tone: "good", title: `Copying ${shortAddress(leader.wallet)} on demo`, body: "Move it to real from Copy trading once it has a record" });
    onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Copy a wallet" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-text">Copy this wallet</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="mt-1 flex items-center gap-2 text-xs text-text-2">
          <WalletLink address={leader.wallet} badges={false} />
          <span className="font-mono">
            {leader.coins} coins · {leader.win_rate.toFixed(0)}% wins
          </span>
        </p>
        <div className="mt-4">
          <Backtest l={leader} />
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-3 text-sm">
          <span className="text-text-2">Per copied buy</span>
          <Num value={r.amount} onChange={(v) => set({ amount: v })} unit="USD" />
          <span className="text-text-2">
            Skip coins below safety
            <span className="block text-[11px] text-muted">Kixo&apos;s score, checked on every buy</span>
          </span>
          <Num value={r.minSafety ?? 0} onChange={(v) => set({ minSafety: v > 0 ? Math.min(100, v) : null })} unit="/100" />
          <span className="text-text-2">Sell when it sells</span>
          <Toggle on={r.mirrorSells} onChange={(v) => set({ mirrorSells: v })} />
          <span className="text-text-2">
            Pause after losing
            <span className="block text-[11px] text-muted">0: never</span>
          </span>
          <Num value={r.maxLoss ?? 0} onChange={(v) => set({ maxLoss: v > 0 ? v : null })} unit="USD" />
          <span className="text-text-2">Copied buys per day, at most</span>
          <Num value={r.maxBuysPerDay} onChange={(v) => set({ maxBuysPerDay: Math.max(1, Math.round(v)) })} unit="" />
          <span className="text-text-2">
            Consensus
            <span className="block text-[11px] text-muted">Buy only when this many of your copied wallets buy it within {r.consensusMins} min</span>
          </span>
          <Num value={r.consensus} onChange={(v) => set({ consensus: Math.max(1, Math.min(5, Math.round(v))) })} unit="wallets" />
        </div>

        <button type="button" onClick={start} disabled={!venue && !!why && why.startsWith("Sign in")} className="mt-5 flex h-10 w-full items-center justify-center rounded-lg bg-text text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40">
          Start on demo
        </button>
        <p className="mt-2 text-[11px] leading-4 text-muted">
          Every copy starts on the demo account at live prices. Once it has {5} closed trades in profit you can move it to real SOL{exit ? ", but not for this wallet while its copiers lose" : ""}. Runs while Kixo is open in this browser
        </p>
      </div>
    </div>
  );
}

function Num({ value, onChange, unit }: { value: number; onChange: (v: number) => void; unit: string }) {
  return (
    <label className="flex h-9 w-36 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
      <input inputMode="decimal" value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)} className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm text-text outline-none" />
      {unit && <span className="font-mono text-xs text-muted">{unit}</span>}
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-6 w-11 justify-self-end rounded-full transition-colors ${on ? "bg-emerald" : "bg-surface-3"}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-text transition-transform ${on ? "left-0.5 translate-x-5" : "left-0.5"}`} />
    </button>
  );
}

/** Copy trading on the Smart Money page: each copy's record, its latest copied trades with
 *  their copy cost, and pause, move to real and remove. */
export function CopyTrades({ leaders }: { leaders: CopyLeader[] }) {
  const on = useFeatures().copy_trading;
  const copies = useCopies();
  if (!on || !copies.length) return null;
  const byWallet = new Map(leaders.map((l) => [l.wallet, l]));
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-sm font-medium text-text">Copy trading</h2>
        <span className="text-xs text-muted">Runs while Kixo is open in this browser</span>
      </header>
      <ul className="divide-y divide-border">
        {copies.map((c) => (
          <CopyRow key={c.id} c={c} leader={byWallet.get(c.leader) ?? null} />
        ))}
      </ul>
    </section>
  );
}

function CopyRow({ c, leader }: { c: Copy; leader: CopyLeader | null }) {
  const [sol, setSol] = useState("0.1");
  const [promoting, setPromoting] = useState(false);
  const exit = leader ? exitLiquidity(leader.realized_sol, leader.copy_return_pct) : false;
  const block = promoteBlock(c, exit);
  const costs = c.events.filter((e) => e.result === "done" && e.costPct != null).map((e) => e.costPct!);
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const open = Object.keys(c.positions).length;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`size-1.5 rounded-full ${c.status === "running" ? "bg-emerald" : "bg-muted"}`} />
          <WalletLink address={c.leader} />
          <span className={`rounded border px-1.5 text-[11px] ${c.venue === "real" ? "border-emerald/30 text-emerald" : "border-warning/30 text-warning"}`}>{c.venue}</span>
          <span className="text-xs text-muted">{c.status === "running" ? "Running" : `Paused${c.pausedWhy ? `: ${c.pausedWhy}` : ""}`}</span>
        </span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => updateCopy(c.id, c.status === "running" ? { status: "paused", pausedWhy: "Paused by you" } : { status: "running", pausedWhy: undefined })} aria-label={c.status === "running" ? "Pause" : "Resume"} className="flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-text">
            {c.status === "running" ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
          </button>
          <button type="button" onClick={() => removeCopy(c.id)} aria-label="Remove" className="flex size-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-3 hover:text-negative">
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-5">
        <Stat k="Realized" v={money(c.venue, c.realized)} tone={c.realized} />
        <Stat k="Copied" v={`${c.buys} buys · ${c.sells} sells`} />
        <Stat k="Open coins" v={String(open)} />
        <Stat k="Copy cost" v={avgCost == null ? "—" : `${avgCost >= 0 ? "+" : "−"}${Math.abs(avgCost).toFixed(1)}%`} hint="Your price vs the leader's, on average" />
        <Stat k="Per buy" v={money(c.venue, c.rules.amount)} />
      </dl>
      {leader && (
        <div className="mt-3">
          <Backtest l={leader} />
        </div>
      )}

      {c.venue === "demo" && c.status === "running" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {block ? (
            <span className="text-muted">Move to real: {block}</span>
          ) : promoting ? (
            <>
              <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-bg px-2">
                <input inputMode="decimal" value={sol} onChange={(e) => setSol(e.target.value.replace(/[^0-9.]/g, ""))} className="w-16 bg-transparent text-right font-mono text-text outline-none" aria-label="SOL per copied buy" />
                <span className="font-mono text-muted">SOL per buy</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  const err = Number(sol) > 0 ? promoteCopy(c, Number(sol)) : "Enter an amount";
                  if (err) pushToast({ tone: "bad", title: "Not moved", body: err });
                  else pushToast({ tone: "good", title: "Copy moved to real", body: "It trades your Kixo wallet while Kixo is open and the wallet unlocked" });
                }}
                className="h-8 rounded-lg bg-text px-3 font-medium text-bg"
              >
                Move to real
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setPromoting(true)} className="h-8 rounded-lg border border-emerald/30 px-3 text-emerald hover:bg-emerald/10">
              Move to real
            </button>
          )}
        </div>
      )}

      {c.events.length > 0 && (
        <ol className="mt-3 flex flex-col gap-1">
          {c.events.slice(0, 4).map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-[11px] text-text-2">
              <span className={e.side === "buy" ? "text-positive" : "text-negative"}>{e.side === "buy" ? "Buy" : "Sell"}</span>
              <span className="text-text">{e.symbol}</span>
              <span className={e.result === "done" ? "text-text-2" : e.result === "skipped" ? "text-muted" : "text-negative"}>
                {e.result === "done" ? (e.profit != null ? money(c.venue, e.profit) : "copied") : e.note}
              </span>
              {e.costPct != null && <span className="font-mono text-muted">cost {e.costPct >= 0 ? "+" : "−"}{Math.abs(e.costPct).toFixed(1)}%</span>}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Stat({ k, v, tone, hint }: { k: string; v: string; tone?: number; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="font-sans text-[11px] text-muted">{k}</dt>
      <dd className={`mt-0.5 ${tone == null ? "text-text" : tone >= 0 ? "text-positive" : "text-negative"}`}>{v}</dd>
    </div>
  );
}
