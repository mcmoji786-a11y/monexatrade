"use client";

import { useState } from "react";
import { Bot, Check, Copy, Loader2, Pause, Play, ShieldCheck } from "lucide-react";
import { createAutoWallet, updateAutoWallet, useAutoWallet, withdrawAutoWallet, type AutoLimits } from "@/lib/auto-wallet";
import { kixoAddress, useKixoWallet, withdrawSol } from "@/lib/kixo-wallet";
import { pushToast } from "@/lib/toast";
import { shortAddress } from "@/lib/gateway";

/** Portfolio: the 24/7 auto-trade wallet. Made on request; its money goes back only to
 *  the main Kixo wallet. */
export function AutoWalletCard() {
  const { data, error, reload } = useAutoWallet();
  const main = useKixoWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [fund, setFund] = useState("");
  // Edits to the limits; the saved ones show until the user changes something.
  const [draft, setLimits] = useState<AutoLimits | null>(null);
  const [copied, setCopied] = useState(false);

  if (!data || !data.available) return null;

  async function run(what: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(what);
    try {
      await fn();
      pushToast({ tone: "good", title: ok });
      reload();
    } catch (e) {
      pushToast({ tone: "bad", title: "Did not work", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const limits = draft ?? data.limits;
  const sol = data.lamports != null ? data.lamports / 1e9 : null;

  return (
    <section className="max-w-xl rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-text">
            <Bot size={16} strokeWidth={1.5} className="text-emerald" /> Auto-trade wallet
          </p>
          <p className="mt-1 text-xs leading-5 text-text-2">Lets orders, grids, copies, the sniper and the AI agent trade 24/7, even when Kixo is closed</p>
        </div>
        {data.exists && (
          <span className={`rounded-md border px-2 py-0.5 text-xs ${data.paused ? "border-warning/40 text-warning" : "border-emerald/40 text-emerald"}`}>{data.paused ? "Paused" : "Active"}</span>
        )}
      </div>

      {!data.exists ? (
        <>
          <ul className="mt-4 flex flex-col gap-2 text-xs leading-5 text-text-2">
            {[
              "A separate wallet: put in only what you want traded automatically",
              "Its money can only go back to your Kixo wallet, never anywhere else",
              "Your limits: max per trade, a daily loss limit, minimum safety score",
              "One switch pauses everything",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <ShieldCheck size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-emerald" /> {t}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!!busy || main.status === "none"}
            onClick={() => run("create", createAutoWallet, "Auto-trade wallet created")}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-text text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "create" && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            Create auto-trade wallet
          </button>
          {main.status === "none" && <p className="mt-2 text-xs text-muted">Create your Kixo wallet first: the auto wallet sends money back only to it</p>}
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p data-private className="font-mono text-2xl tabular-nums text-text">
                {sol != null ? sol.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "…"} <span className="font-sans text-sm text-text-2">SOL</span>
              </p>
              <button
                type="button"
                onClick={() => data.pubkey && navigator.clipboard.writeText(data.pubkey).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
                className="mt-1 flex items-center gap-1.5 font-mono text-xs text-cyan"
              >
                <span data-private>{shortAddress(data.pubkey ?? "")}</span>
                {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
              </button>
            </div>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run("pause", () => updateAutoWallet({ paused: !data.paused }), data.paused ? "Automatic trading resumed" : "Automatic trading paused")}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              {data.paused ? <Play size={14} strokeWidth={1.5} /> : <Pause size={14} strokeWidth={1.5} />}
              {data.paused ? "Resume" : "Pause all"}
            </button>
          </div>
          {data.over_max && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              Above the {data.max_balance_sol} SOL limit for an auto wallet: automatic trading waits until you move the extra back
            </p>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              inputMode="decimal"
              value={fund}
              onChange={(e) => setFund(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="SOL from your Kixo wallet"
              aria-label="SOL to move in"
              className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-emerald/50"
            />
            <button
              type="button"
              disabled={!!busy || !(Number(fund) > 0) || main.status !== "unlocked" || !data.pubkey}
              onClick={() => run("fund", () => withdrawSol(data.pubkey!, Number(fund)).then(() => setFund("")), "Moving SOL in, it lands in a few seconds")}
              className="h-10 rounded-lg border border-border px-3 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
            >
              Move in
            </button>
          </div>
          {main.status !== "unlocked" && <p className="-mt-2 text-xs text-muted">Unlock your Kixo wallet above to move SOL in. No Kixo fee between your own wallets</p>}

          {limits && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max per trade, SOL" value={limits.max_trade_sol} step={0.01} onChange={(v) => setLimits({ ...limits, max_trade_sol: v })} />
              <Field label="Daily loss limit, SOL" value={limits.daily_loss_sol} step={0.1} onChange={(v) => setLimits({ ...limits, daily_loss_sol: v })} />
              <Field label="Min safety score" value={limits.min_safety} step={5} onChange={(v) => setLimits({ ...limits, min_safety: Math.round(v) })} />
              <Field label="Max slippage, %" value={limits.max_slippage_bps / 100} step={0.5} onChange={(v) => setLimits({ ...limits, max_slippage_bps: Math.round(v * 100) })} />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => run("limits", () => updateAutoWallet({ limits }).then(() => setLimits(null)), "Limits saved")}
                className="col-span-2 h-9 rounded-lg border border-border text-sm text-text hover:bg-surface-2 disabled:opacity-50"
              >
                Save limits
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={!!busy || !(data.lamports && data.lamports > 10_000)}
            onClick={() => run("out", () => withdrawAutoWallet(true), `Sending everything back to ${shortAddress(kixoAddress() ?? data.owner ?? "")}`)}
            className="h-9 rounded-lg text-sm text-text-2 underline underline-offset-2 hover:text-text disabled:opacity-40"
          >
            Move everything back to my Kixo wallet
          </button>
          <p className="text-xs leading-5 text-muted">Kixo holds this wallet&apos;s key, sealed and encrypted, so it can trade while you are away. Keep in it only what you want traded automatically</p>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-warning">{error}</p>}
    </section>
  );
}

function Field({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-2">
      {label}
      <input
        type="number"
        step={step}
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-lg border border-border bg-bg px-3 font-mono text-sm text-text outline-none focus:border-emerald/50"
      />
    </label>
  );
}
