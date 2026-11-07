"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { refreshDemo, useDemo, orderError } from "@/lib/demo";
import { cancelRule, createRule } from "@/lib/growth";
import { useFeatures } from "@/lib/features";
import { pushToast } from "@/lib/toast";
import { tinyPrice } from "./trade-panel";

const TP_PRESETS = [25, 50, 100, 300];
const SL_PRESETS = [-10, -20, -35, -50];

/** Take profit and stop loss on the demo position in this coin. The gateway checks
 *  them against the live price every two seconds and sells at the market. */
export function ExitOrders({ mint, livePrice }: { mint: string; livePrice: number | null }) {
  const { mode, account, rules } = useDemo();
  const on = useFeatures().demo_orders;
  const [kind, setKind] = useState<"tp" | "sl">("tp");
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);
  const pos = account?.positions.find((p) => p.mint === mint);
  if (!on || mode !== "demo" || !pos) return null;

  const open = rules.filter((r) => r.mint === mint && r.status === "open");
  const entry = pos.cost_usd / pos.tokens;
  const value = Number(pct);
  const signedPct = kind === "tp" ? Math.abs(value) : -Math.abs(value);
  const valid = pct !== "" && Number.isFinite(value) && (kind === "tp" ? signedPct >= 1 && signedPct <= 10000 : signedPct <= -1 && signedPct >= -95);
  const target = valid ? entry * (1 + signedPct / 100) : null;

  async function add(p = signedPct) {
    setBusy(true);
    try {
      await createRule({ mint, kind, pct: p });
      pushToast({ tone: "good", title: `${kind === "tp" ? "Take profit" : "Stop loss"} set at ${p > 0 ? "+" : ""}${p}%` });
      setPct("");
      await refreshDemo();
    } catch (e) {
      pushToast({ tone: "bad", title: "Order not placed", body: orderError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: number) {
    try {
      await cancelRule(id);
      await refreshDemo();
    } catch (e) {
      pushToast({ tone: "bad", title: "Could not cancel", body: orderError(e) });
    }
  }

  return (
    <section className="border-b border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Take profit / Stop loss</h2>
        <span className="font-mono text-[11px] text-muted">Entry {tinyPrice(entry)}</span>
      </div>

      {open.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {open.map((r) => {
            const away = livePrice ? (r.trigger_price_usd / livePrice - 1) * 100 : null;
            return (
              <li key={r.id} className="flex h-9 items-center justify-between rounded-lg border border-border px-3 text-xs">
                <span className={r.kind === "tp" ? "text-positive" : "text-negative"}>
                  {r.kind === "tp" ? "TP" : "SL"} {r.trigger_pct > 0 ? "+" : ""}
                  {Number(r.trigger_pct)}%
                </span>
                <span className="font-mono text-text-2">{tinyPrice(Number(r.trigger_price_usd))}</span>
                <span className="font-mono text-muted">{away != null ? `${away >= 0 ? "+" : "−"}${Math.abs(away).toFixed(1)}% away` : ""}</span>
                <button type="button" onClick={() => cancel(r.id)} aria-label="Cancel order" className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-text">
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
        {(["tp", "sl"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => (setKind(k), setPct(""))}
            className={`h-8 rounded-md text-xs transition-colors ${kind === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
          >
            {k === "tp" ? "Take profit" : "Stop loss"}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {(kind === "tp" ? TP_PRESETS : SL_PRESETS).map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy}
            onClick={() => add(p)}
            className={`h-8 rounded-md border border-border font-mono text-xs transition-colors hover:bg-surface-3 disabled:opacity-50 ${p > 0 ? "text-positive" : "text-negative"}`}
          >
            {p > 0 ? "+" : ""}
            {p}%
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <span className="font-mono text-xs text-muted">{kind === "tp" ? "+" : "−"}</span>
          <input
            inputMode="decimal"
            value={pct}
            onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && valid && !busy && add()}
            placeholder="Custom"
            aria-label={kind === "tp" ? "Take profit percent" : "Stop loss percent"}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text outline-none placeholder:text-muted"
          />
          <span className="font-mono text-xs text-muted">%</span>
        </label>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => add()}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-text px-3 text-xs font-medium text-bg disabled:opacity-40"
        >
          {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
          Set
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {target ? `Sells all at ${tinyPrice(target)}, checked every 2 seconds` : "Sells the whole position at the live price when it crosses the level"}
      </p>
    </section>
  );
}
