"use client";

import { useFeatures } from "@/lib/features";
import { useEffect, useState } from "react";
import { BellPlus, X } from "lucide-react";
import { usd } from "@/lib/gateway";
import { usePriceAlerts } from "@/lib/prefs";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

/** Trade page button: alert when this coin's market cap goes above or below a level. */
function PriceAlertButtonInner({ mint, symbol, mcUsd }: { mint: string; symbol: string; mcUsd: number | null }) {
  const { list, add, remove } = usePriceAlerts();
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(true);
  const [value, setValue] = useState("");
  const mine = list.filter((a) => a.mint === mint);

  const save = async () => {
    const n = Number(value.replace(/[$,k]/gi, "")) * (/k$/i.test(value.trim()) ? 1_000 : 1);
    if (!Number.isFinite(n) || n <= 0) return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
    add({ mint, symbol, above, mcUsd: n });
    setValue("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors hover:bg-surface-2 ${mine.length ? "border-emerald/40 text-text" : "border-border text-text-2"}`}
      >
        <BellPlus size={14} strokeWidth={1.5} />
        Alert
        {mine.length > 0 && <span className="font-mono text-xs text-emerald">{mine.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-border bg-surface-2 p-3 shadow-lg">
          <p className="text-sm font-medium text-text">Market cap alert</p>
          <p className="mt-0.5 text-xs text-muted">Now {usd(mcUsd)}. Fires once while Kixo is open in this browser</p>
          <div className="mt-3 flex gap-1 rounded-lg border border-border p-0.5">
            {[true, false].map((a) => (
              <button
                key={String(a)}
                type="button"
                onClick={() => setAbove(a)}
                aria-pressed={above === a}
                className={`h-7 flex-1 rounded-md text-xs ${above === a ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
              >
                {a ? "Goes above" : "Falls below"}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="100000 or 100k"
              inputMode="decimal"
              aria-label="Market cap in USD"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 font-mono text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
            />
            <button type="submit" className="h-8 rounded-md bg-surface-3 px-3 text-sm text-text hover:bg-surface">
              Add
            </button>
          </form>
          {mine.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {mine.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-xs text-text-2">
                  {a.above ? "Above" : "Below"} <span className="font-mono text-text">{usd(a.mcUsd)}</span>
                  <button type="button" onClick={() => remove(a.id)} aria-label="Delete alert" className="ml-auto text-muted hover:text-text">
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Mounted once in the app shell: checks every alert against the live feed. */
export function PriceAlertWatcher() {
  const { list, remove } = usePriceAlerts();
  const { tokens, markets, solUsd } = useRadarFeed();

  useEffect(() => {
    if (!list.length) return;
    for (const a of list) {
      const own = tokens.find((t) => t.mint === a.mint)?.market;
      const mc = (own?.sol_quoted ? own.mc_usd : null) ?? markets[a.mint]?.mc_usd ?? null;
      if (mc == null) continue;
      if (a.above ? mc >= a.mcUsd : mc <= a.mcUsd) {
        remove(a.id);
        const text = `${a.symbol} market cap ${a.above ? "above" : "below"} ${usd(a.mcUsd)} (now ${usd(mc)})`;
        if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Kixo price alert", { body: text, tag: a.id });
        else window.alert(text);
      }
    }
  }, [list, tokens, markets, solUsd, remove]);

  return null;
}

/** Hidden when the admin switches "price_alerts" off (lib/features.ts). */
export function PriceAlertButton(props: { mint: string; symbol: string; mcUsd: number | null }) {
  const f = useFeatures();
  return f.price_alerts ? <PriceAlertButtonInner {...props} /> : null;
}
