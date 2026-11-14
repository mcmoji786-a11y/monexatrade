"use client";
/* Copy Kixo AI: the sniper engine with the AI's rules (lib/sniper.ts AI_PRESET). Buys go
   to the account the sniper trades on (demo by default) and every result is shown here. */
import Link from "next/link";
import { Bot } from "lucide-react";
import { activePreset, AI_PRESET, pnl, useSniper } from "@/lib/sniper";
import { useSniperAccount } from "@/components/sniper/sniper-engine";

const AMOUNTS = [10, 25, 50, 100];

export function CopyAiCard() {
  const { settings, positions, update } = useSniper();
  const { account, why } = useSniperAccount();
  const onAi = activePreset(settings) === AI_PRESET.key;
  const running = settings.enabled && onAi;
  const otherRules = settings.enabled && !onAi;

  const mine = positions.filter((p) => p.ai);
  const open = mine.filter((p) => !p.exitTs).length;
  const closed = mine.filter((p) => p.exitTs);
  const wins = closed.filter((p) => (pnl(p, null)?.sol ?? 0) > 0).length;
  const realized = closed.reduce((s, p) => s + (pnl(p, null)?.sol ?? 0), 0);
  const amount = settings.buyUnit === "USD" ? settings.buyUsd : null;

  const start = (usd: number) => update({ ...AI_PRESET.patch, enabled: true, buyUnit: "USD", buyUsd: usd });

  return (
    <section className="flex flex-col rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot size={16} strokeWidth={1.5} className={running ? "text-emerald" : "text-muted"} />
        <h2 className="text-sm font-medium text-text">Copy Kixo AI</h2>
        <span className={`ml-auto flex items-center gap-1.5 text-xs ${running ? "text-emerald" : "text-muted"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-emerald" : "bg-muted"}`} />
          {running ? "Copying" : "Off"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <p className="text-sm leading-6 text-text-2">
          Buys the coins the AI rates under {AI_PRESET.patch.aiMaxDump}% dump risk with {AI_PRESET.patch.aiMinPump}%+ 2x odds, then sells at +
          {AI_PRESET.patch.takeProfitPct}%, -{AI_PRESET.patch.stopLossPct}% or after an hour
        </p>

        <div>
          <div className="text-xs text-muted">Each buy</div>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => (running ? update({ buyUnit: "USD", buyUsd: a }) : start(a))}
                aria-pressed={amount === a && running}
                className={`h-9 rounded-lg border font-mono text-sm transition-colors ${
                  amount === a && running ? "border-emerald/50 bg-emerald/10 text-emerald" : "border-border text-text-2 hover:bg-surface-2 hover:text-text"
                }`}
              >
                ${a}
              </button>
            ))}
          </div>
        </div>

        {running ? (
          <button type="button" onClick={() => update({ enabled: false })} className="h-10 rounded-lg border border-border text-sm text-text transition-colors hover:bg-surface-2">
            Stop copying
          </button>
        ) : (
          <button type="button" onClick={() => start(amount ?? 25)} className="h-10 rounded-lg bg-emerald text-sm font-medium text-bg transition-opacity hover:opacity-90">
            Start copying on {account === "real" ? "real" : account === "demo" ? "demo" : "paper"}
          </button>
        )}

        <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-bg px-3 py-2.5">
          <div>
            <dt className="text-[11px] text-muted">Open</dt>
            <dd className="font-mono text-sm text-text">{open}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Win rate</dt>
            <dd className="font-mono text-sm text-text">{closed.length ? `${Math.round((wins / closed.length) * 100)}%` : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Realised</dt>
            <dd className={`font-mono text-sm ${realized > 0 ? "text-positive" : realized < 0 ? "text-negative" : "text-text"}`}>
              {closed.length ? `${realized >= 0 ? "+" : "−"}${Math.abs(realized).toFixed(3)} SOL` : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-auto flex flex-col gap-1.5 text-xs text-muted">
          {otherRules && <p className="text-warning">Your Sniper runs other rules now. Starting replaces them with the AI&apos;s</p>}
          {why && <p>{why}</p>}
          <p>
            Runs while Kixo is open, through your Sniper.{" "}
            <Link href="/sniper" className="text-cyan hover:underline">
              See every trade
            </Link>
          </p>
          <p>In testing, the AI&apos;s favourites still lost money after fees. Prove it on demo first</p>
        </div>
      </div>
    </section>
  );
}
