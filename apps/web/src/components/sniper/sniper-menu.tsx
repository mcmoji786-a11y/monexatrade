"use client";

import { useFeatures } from "@/lib/features";
import { useState } from "react";
import Link from "next/link";
import { Crosshair } from "lucide-react";
import { sol } from "@/lib/gateway";
import { activePreset, pnl, PRESETS, useSniper, type SniperSettings } from "@/lib/sniper";
import { tokenHref } from "@/lib/open-token";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

/** Sniper button in the Sol Radar toolbar: on/off, a preset, the settings people change
 *  most, alerts and the latest buys and sells. Full rules live on the Sniper page. */
function SniperMenuInner() {
  const { settings: s, positions, update } = useSniper();
  const { tokens, solUsd } = useRadarFeed();
  const [open, setOpen] = useState(false);
  const live = positions.filter((p) => !p.exitTs);
  const price = (mint: string) => tokens.find((t) => t.mint === mint)?.market?.price_sol ?? null;
  const total = positions.reduce((sum, p) => sum + (pnl(p, p.exitTs ? null : price(p.mint)).sol ?? 0), 0);
  const preset = activePreset(s);
  // Latest activity: buys and sells, newest first.
  const recent = positions
    .flatMap((p) => [{ p, kind: "buy" as const, ts: p.entryTs }, ...(p.exitTs ? [{ p, kind: "sell" as const, ts: p.exitTs }] : [])])
    .sort((x, y) => y.ts - x.ts)
    .slice(0, 4);

  const desktop = async () => {
    if (!s.notifyDesktop && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      if ((await Notification.requestPermission()) !== "granted") return;
    }
    update({ notifyDesktop: !s.notifyDesktop });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors hover:bg-surface-2 ${
          s.enabled ? "border-emerald/40 text-text" : "border-border text-muted"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "live-ring bg-emerald" : "bg-muted"}`} />
        <Crosshair size={14} strokeWidth={1.5} />
        Sniper
        {live.length > 0 && <span className="font-mono text-xs text-emerald">{live.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-96 rounded-xl border border-border bg-surface-2 p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <span>
              <p className="text-sm font-medium text-text">Sniper</p>
              <p className="text-[11px] text-warning">Paper mode: real prices, simulated buys</p>
            </span>
            <Switch on={s.enabled} onChange={() => update({ enabled: !s.enabled })} label="Sniper on" />
          </div>

          {/* Presets */}
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {PRESETS.map((pr) => (
              <button
                key={pr.key}
                type="button"
                onClick={() => update(pr.patch)}
                title={pr.hint}
                aria-pressed={preset === pr.key}
                className={`h-8 rounded-lg border text-xs transition-colors ${preset === pr.key ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-border text-text-2 hover:text-text"}`}
              >
                {pr.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted">{preset ? PRESETS.find((p) => p.key === preset)!.hint : "Custom rules"}</p>

          <div className="mt-3 grid grid-cols-3 items-start gap-2">
            <AmountField s={s} update={update} solUsd={solUsd} />
            <Field label="Take profit %" value={s.takeProfitPct} step={5} onChange={(v) => update({ takeProfitPct: v })} />
            <Field label="Stop loss %" value={s.stopLossPct} step={5} onChange={(v) => update({ stopLossPct: v })} />
          </div>

          {/* Safety floor */}
          <label className="mt-3 block text-[11px] text-muted">
            <span className="flex justify-between">
              Only coins with safety of at least
              <span className={`font-mono ${s.minSafety >= 75 ? "text-positive" : s.minSafety >= 50 ? "text-warning" : "text-negative"}`}>{s.minSafety}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={s.minSafety}
              onChange={(e) => update({ minSafety: Number(e.target.value) })}
              className="mt-1 w-full accent-emerald"
              aria-label="Minimum safety score"
            />
          </label>

          {/* Alerts */}
          <div className="mt-2 flex items-center gap-1.5">
            <span className="mr-auto text-[11px] text-muted">Alert on buy and sell</span>
            <Pill on={s.notifyToast} onClick={() => update({ notifyToast: !s.notifyToast })} label="Pop-up" />
            <Pill on={s.notifySound} onClick={() => update({ notifySound: !s.notifySound })} label="Sound" />
            <Pill on={s.notifyDesktop} onClick={desktop} label="Desktop" />
          </div>

          {/* Result and recent activity */}
          <div className="mt-3 rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 font-mono text-xs">
              <span className="text-text-2">{live.length} open</span>
              <span className={total >= 0 ? "text-positive" : "text-negative"}>
                P&amp;L {total >= 0 ? "+" : ""}
                {sol(total)}
                {solUsd ? <span className="ml-1 opacity-70">({total >= 0 ? "+" : "−"}${Math.abs(total * solUsd).toFixed(2)})</span> : null}
              </span>
            </div>
            {recent.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px] text-muted">{s.enabled ? "Watching for a coin that passes your rules" : "Turn it on to start"}</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map(({ p, kind }) => {
                  const r = kind === "sell" ? pnl(p, null) : null;
                  return (
                    <li key={p.id + kind} className="flex h-8 items-center gap-2 px-3 text-xs">
                      <span className={`w-9 shrink-0 ${kind === "buy" ? "text-cyan" : (r?.sol ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{kind === "buy" ? "Buy" : "Sell"}</span>
                      <Link href={tokenHref(p.mint)} className="min-w-0 truncate text-text hover:text-cyan">
                        {p.symbol || "coin"}
                      </Link>
                      <span className="ml-auto font-mono text-text-2">
                        {kind === "buy" ? sol(p.sizeSol) : r?.pct != null ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(0)}%` : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Link href="/sniper" className="mt-3 flex h-8 items-center justify-center rounded-lg bg-surface-3 text-sm text-text hover:bg-surface">
            Full rules and dashboard
          </Link>
        </div>
      )}
    </div>
  );
}

function Pill({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-6 rounded-full border px-2 text-[11px] transition-colors ${on ? "border-emerald/40 text-emerald" : "border-border text-muted hover:text-text"}`}
    >
      {label}
    </button>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 ${on ? "border-emerald/50 bg-emerald/30" : "border-border bg-surface-3"}`}
    >
      <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all duration-200 ${on ? "left-5.5 bg-emerald" : "left-0.5 bg-text-2"}`} />
    </button>
  );
}

export function Field({ label, value, step, onChange, suffix }: { label: string; value: number | null; step: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 font-mono text-sm text-text outline-none focus:border-emerald/50"
        />
        {suffix && <span className="text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

/** Buy amount in SOL or USD, with the other currency shown as a guide. */
export function AmountField({ s, update, solUsd }: { s: SniperSettings; update: (p: Partial<SniperSettings>) => void; solUsd: number | null }) {
  const usdMode = s.buyUnit === "USD";
  const other = usdMode ? (solUsd ? `≈ ${(s.buyUsd / solUsd).toFixed(3)} SOL` : "SOL price loading") : solUsd ? `≈ $${(s.buySol * solUsd).toFixed(2)}` : "";
  return (
    <div className="flex flex-col gap-1 text-[11px] text-muted">
      <span className="flex items-center justify-between">
        Amount
        <span className="flex rounded-md border border-border p-0.5" role="group" aria-label="Amount currency">
          {(["SOL", "USD"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => update({ buyUnit: u })}
              aria-pressed={s.buyUnit === u}
              className={`h-5 rounded px-1.5 font-mono text-[10px] ${s.buyUnit === u ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
            >
              {u}
            </button>
          ))}
        </span>
      </span>
      <span className="relative flex items-center">
        {usdMode && <span className="pointer-events-none absolute left-2 font-mono text-sm text-muted">$</span>}
        <input
          type="number"
          min={0}
          step={usdMode ? 1 : 0.05}
          value={usdMode ? s.buyUsd : s.buySol}
          onChange={(e) => update(usdMode ? { buyUsd: Math.max(0, Number(e.target.value) || 0) } : { buySol: Math.max(0, Number(e.target.value) || 0) })}
          aria-label={`Amount in ${s.buyUnit}`}
          className={`h-8 w-full min-w-0 rounded-md border border-border bg-surface pr-2 font-mono text-sm text-text outline-none focus:border-emerald/50 ${usdMode ? "pl-5" : "pl-2"}`}
        />
      </span>
      <span className="font-mono text-[10px] text-muted">{other}</span>
    </div>
  );
}

/** Hidden when the admin switches "sniper" off (lib/features.ts). */
export function SniperMenu(props: Record<string, never>) {
  const f = useFeatures();
  return f.sniper ? <SniperMenuInner {...props} /> : null;
}
