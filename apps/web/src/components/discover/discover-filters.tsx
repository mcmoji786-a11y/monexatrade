"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { DiscoverRow } from "@/lib/categories";
import { useDiscoverFilters, type DiscoverFilters } from "@/lib/prefs";

/** Does a Discover row pass the user's ranges? Unknown values fail a set minimum. */
export function passesDiscover(r: DiscoverRow, f: DiscoverFilters, nowSecs: number) {
  const ageH = r.createdAt != null ? (nowSecs - r.createdAt) / 3600 : null;
  const min = (v: number | null, lim: number | null) => lim == null || (v != null && v >= lim);
  const max = (v: number | null, lim: number | null) => lim == null || v == null || v <= lim;
  return (
    min(r.mcUsd, f.minMcUsd) &&
    max(r.mcUsd, f.maxMcUsd) &&
    min(r.liquidityUsd, f.minLiquidityUsd) &&
    min(r.vol1hUsd, f.minVol1hUsd) &&
    min(r.holders, f.minHolders) &&
    min(ageH, f.minAgeHours) &&
    max(ageH, f.maxAgeHours)
  );
}

const FIELDS: { key: keyof DiscoverFilters; label: string }[] = [
  { key: "minMcUsd", label: "Min market cap $" },
  { key: "maxMcUsd", label: "Max market cap $" },
  { key: "minLiquidityUsd", label: "Min liquidity $" },
  { key: "minVol1hUsd", label: "Min volume 1h $" },
  { key: "minHolders", label: "Min holders" },
  { key: "minAgeHours", label: "Min age, hours" },
  { key: "maxAgeHours", label: "Max age, hours" },
];

export function DiscoverFiltersMenu() {
  const { filters: f, count, set, reset } = useDiscoverFilters();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors hover:bg-surface-2 ${count ? "border-emerald/40 text-text" : "border-border text-muted"}`}
      >
        <SlidersHorizontal size={14} strokeWidth={1.5} />
        Filters
        {count > 0 && <span className="font-mono text-xs text-emerald">{count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-border bg-surface-2 p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text">Filters</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={reset} className="text-xs text-muted hover:text-text">
                Reset
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-text">
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            {FIELDS.map((fd) => (
              <label key={fd.key} className="flex flex-col gap-1 text-xs text-muted">
                {fd.label}
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={f[fd.key] ?? ""}
                  onChange={(e) => set({ [fd.key]: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                  placeholder="Any"
                  className="h-8 rounded-md border border-border bg-surface px-2 font-mono text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted">Applies to every category. Saved in this browser</p>
        </div>
      )}
    </div>
  );
}
