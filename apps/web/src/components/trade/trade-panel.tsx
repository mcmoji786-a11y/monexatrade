"use client";

import { useState } from "react";

const PRESETS = ["0.1", "0.5", "1", "2"];

/** Order ticket. Layout only: no wallet connects and no order is sent. Real-money
 *  trading stays off until the founder approves it after a security review. */
export function TradePanel({ symbol }: { symbol: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");

  return (
    <section className="border-b border-border p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={`h-9 rounded-md text-sm capitalize transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${
              side === s ? (s === "buy" ? "bg-[#2ebd85] font-medium text-bg" : "bg-[#f6465d] font-medium text-text") : "text-text-2 hover:text-text"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-4 text-sm">
        {(["market", "limit"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`capitalize transition-colors ${kind === k ? "text-text" : "text-muted hover:text-text-2"}`}
          >
            {k}
          </button>
        ))}
      </div>

      <label className="mt-3 flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
        <span className="text-xs text-muted">Amount</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.0"
          className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm text-text outline-none placeholder:text-muted"
        />
        <span className="font-mono text-xs text-text-2">{side === "buy" ? "SOL" : "%"}</span>
      </label>

      <div className="mt-2 grid grid-cols-4 gap-1">
        {(side === "buy" ? PRESETS : ["25", "50", "75", "100"]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(p)}
            className="h-8 rounded-md border border-border font-mono text-xs text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
          >
            {side === "buy" ? p : `${p}%`}
          </button>
        ))}
      </div>

      {kind === "limit" && (
        <label className="mt-2 flex h-11 items-center gap-2 rounded-lg border border-border bg-bg px-3">
          <span className="text-xs text-muted">At market cap</span>
          <input disabled placeholder="$0" className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm outline-none placeholder:text-muted" />
        </label>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-2 font-mono text-xs">
        <Setting k="Slippage" v="15%" />
        <Setting k="Priority" v="0.001" />
        <Setting k="MEV guard" v="On" />
      </dl>

      <button
        type="button"
        disabled
        className={`mt-4 h-11 w-full cursor-not-allowed rounded-full text-sm font-medium opacity-60 ${side === "buy" ? "bg-[#2ebd85] text-bg" : "bg-[#f6465d] text-text"}`}
      >
        {side === "buy" ? "Buy" : "Sell"} {symbol || "token"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">Trading opens after wallet connect, coming soon</p>
    </section>
  );
}

function Setting({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="mt-0.5 text-text-2">{v}</dd>
    </div>
  );
}
