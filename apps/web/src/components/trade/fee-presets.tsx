"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { activeFee, updateSettings, useSettings, type FeePreset } from "@/lib/settings";

/* Fee presets for real trades, three for buying and three for selling (P1, P2, P3), the
   way traders set them on other terminals: Auto lets Kixo pick a low fee from the network,
   otherwise the user's own priority fee and tip. Kept in the account (gateway settings.rs,
   which clamps them). */

const LIMITS = { minPriority: 0.000001, minTip: 0.000005, max: 0.1 };

type Side = "buy" | "sell";

function patch(side: Side, i: number, p: Partial<FeePreset>) {
  updateSettings((s) => {
    const key = side === "buy" ? "buy_fees" : "sell_fees";
    const list = s.trading[key].map((x, j) => (j === i ? { ...x, ...p } : x));
    return { ...s, trading: { ...s.trading, [key]: list } };
  });
}

function pick(side: Side, i: number) {
  updateSettings((s) => ({ ...s, trading: { ...s.trading, [side === "buy" ? "buy_fee" : "sell_fee"]: i } }));
}

/** One line about a preset, for the ticket. */
export function feeLine(p: FeePreset) {
  const fees = p.auto ? "Auto fee" : `${trim(p.priority_sol)} + ${trim(p.tip_sol)} SOL`;
  return `${fees} · slippage ${p.slippage_bps / 100}%${p.mev ? " · MEV on" : ""}`;
}

const trim = (n: number) => String(Number(n.toFixed(6)));

/** The most a preset can cost per trade on top of Kixo's fee, in SOL (null when Auto). */
export const presetCost = (p: FeePreset) => (p.auto ? null : p.priority_sol + p.tip_sol);

/** P1 / P2 / P3 for one side, and the fields of the one in use. `compact` is the ticket. */
export function FeePresets({ side, compact = false, amountSol }: { side: Side; compact?: boolean; amountSol?: number }) {
  const t = useSettings().settings.trading;
  const i = side === "buy" ? t.buy_fee : t.sell_fee;
  const p = activeFee(t, side);
  const [open, setOpen] = useState(!compact);
  const cost = presetCost(p);
  const heavy = cost != null && amountSol != null && amountSol > 0 && cost / amountSol > 0.05;

  return (
    <div className={compact ? "mt-3" : ""}>
      <div className="flex items-center gap-2">
        {compact && <span className="text-[11px] text-muted">Fees</span>}
        <div role="radiogroup" aria-label={`${side === "buy" ? "Buy" : "Sell"} fee preset`} className="flex rounded-md border border-border p-0.5">
          {[0, 1, 2].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={i === n}
              onClick={() => pick(side, n)}
              className={`h-6 min-w-9 rounded px-2 font-mono text-[11px] transition-colors ${i === n ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
            >
              P{n + 1}
            </button>
          ))}
        </div>
        {compact && (
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2">{feeLine(p)}</span>
            <button type="button" aria-expanded={open} aria-label="Edit fees" onClick={() => setOpen(!open)} className={`grid size-6 place-items-center rounded transition-colors ${open ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}>
              <Settings2 size={13} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>

      {open && <Fields key={`${side}${i}`} p={p} onChange={(x) => patch(side, i, x)} />}
      {heavy && <p className="mt-2 text-[11px] text-warning">Priority fee and tip are {Math.round((cost! / amountSol!) * 100)}% of this trade. Use P1 or lower them for small trades</p>}
    </div>
  );
}

function Fields({ p, onChange }: { p: FeePreset; onChange: (x: Partial<FeePreset>) => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-border p-2.5 text-[11px]">
      <label className="col-span-2 flex items-center justify-between gap-3">
        <span>
          <span className="text-text">Auto fee</span>
          <span className="block text-muted">Kixo picks a low priority fee from the network, with the smallest tip</span>
        </span>
        <Toggle on={p.auto} onChange={(v) => onChange({ auto: v })} label="Auto fee" />
      </label>
      <Num label="Priority fee" unit="SOL" value={p.priority_sol} min={LIMITS.minPriority} max={LIMITS.max} disabled={p.auto} onChange={(v) => onChange({ priority_sol: v })} />
      <Num label="Tip" unit="SOL" value={p.tip_sol} min={LIMITS.minTip} max={LIMITS.max} disabled={p.auto} onChange={(v) => onChange({ tip_sol: v })} />
      <Num label="Slippage" unit="%" value={p.slippage_bps / 100} min={0.1} max={50} onChange={(v) => onChange({ slippage_bps: Math.round(v * 100) })} />
      <label className="flex items-end justify-between gap-2 pb-1.5">
        <span className="text-muted" title="Avoids validators known for sandwich attacks">
          MEV protection
        </span>
        <Toggle on={p.mev} onChange={(v) => onChange({ mev: v })} label="MEV protection" />
      </label>
      {!p.auto && p.tip_sol < 0.001 && <p className="col-span-2 text-muted">A tip under 0.001 SOL goes through staked connections only. It is cheaper and can be slower when the network is busy</p>}
    </div>
  );
}

/** A number field that keeps what is typed and saves it, inside its limits, when left. */
function Num({ label, unit, value, min, max, disabled, onChange }: { label: string; unit: string; value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void }) {
  // What is being typed; the saved value shows otherwise.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? trim(value);
  const commit = () => {
    setDraft(null);
    const v = Number(text);
    if (!Number.isFinite(v) || text.trim() === "") return;
    const fit = Math.min(max, Math.max(min, v));
    if (fit !== value) onChange(fit);
  };
  return (
    <label className={`flex flex-col gap-1 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-muted">{label}</span>
      <span className="flex h-8 items-center gap-1 rounded-md border border-border bg-bg px-2 focus-within:border-emerald/50">
        <input
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text outline-none disabled:cursor-not-allowed"
        />
        <span className="font-mono text-muted">{unit}</span>
      </span>
    </label>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-emerald" : "bg-surface-3"}`}>
      <span className={`absolute top-0.5 size-4 rounded-full bg-text transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}
