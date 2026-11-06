"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { shortAddress, type MarketToken } from "@/lib/gateway";
import { activeFilterCount, useRadarFilters, type RadarFilters } from "@/lib/prefs";
import type { RadarToken } from "./use-radar-feed";

/** A launch's stage: new on its curve, close to graduating, or graduated. */
export const STAGES: { key: string; label: string }[] = [
  { key: "new", label: "New" },
  { key: "final", label: "About to graduate" },
  { key: "graduated", label: "Graduated" },
];
const GRADUATING_PCT = 70;

export function stageOf(t: RadarToken) {
  const m = t.market;
  if (m?.complete) return "graduated";
  if (m && m.curve_progress >= GRADUATING_PCT) return "final";
  return "new";
}

const words = (s: string) =>
  s
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

/** Does a coin pass the user's filters and blacklist? `alt`: provider figures. */
export function passesFilters(t: RadarToken, alt: MarketToken | null, f: RadarFilters, nowSecs: number) {
  if (f.blockedDevs.includes(t.creator)) return false;
  const m = t.market;
  const mc = (m?.sol_quoted ? m.mc_usd : null) ?? alt?.mc_usd ?? null;
  const holders = m?.holders ?? alt?.holders ?? null;
  if (f.minMcUsd != null && (mc == null || mc < f.minMcUsd)) return false;
  if (f.maxMcUsd != null && mc != null && mc > f.maxMcUsd) return false;
  if (f.maxAgeMin != null && nowSecs - t.timestamp > f.maxAgeMin * 60) return false;
  if (f.minHolders != null && (holders == null || holders < f.minHolders)) return false;
  if (f.maxDevPct != null && m && m.dev_pct > f.maxDevPct) return false;
  if (f.maxTop10Pct != null && m && m.top10_pct > f.maxTop10Pct) return false;
  if (f.maxBundlePct != null && m && m.bundle_pct > f.maxBundlePct) return false;
  if (f.socialsOnly && !(t.meta && (t.meta.twitter || t.meta.telegram || t.meta.website))) return false;
  if (f.stages.length && !f.stages.includes(stageOf(t))) return false;
  const text = `${t.symbol} ${t.name}`.toLowerCase();
  const inc = words(f.include);
  if (inc.length && !inc.some((w) => text.includes(w))) return false;
  if (words(f.exclude).some((w) => text.includes(w))) return false;
  return true;
}

/** "Filters" button with the panel: ranges, sources, keywords and the dev blacklist. */
export function FiltersMenu() {
  const { filters: f, set, reset, unblockDev } = useRadarFilters();
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(f);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors hover:bg-surface-2 ${
          n ? "border-emerald/40 text-text" : "border-border text-muted"
        }`}
      >
        <SlidersHorizontal size={14} strokeWidth={1.5} />
        Filters
        {n > 0 && <span className="font-mono text-xs text-emerald">{n}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-96 rounded-lg border border-border bg-surface-2 p-4 shadow-lg">
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
            <Num label="Min market cap $" value={f.minMcUsd} onChange={(v) => set({ minMcUsd: v })} />
            <Num label="Max market cap $" value={f.maxMcUsd} onChange={(v) => set({ maxMcUsd: v })} />
            <Num label="Max age, minutes" value={f.maxAgeMin} onChange={(v) => set({ maxAgeMin: v })} />
            <Num label="Min holders" value={f.minHolders} onChange={(v) => set({ minHolders: v })} />
            <Num label="Max dev %" value={f.maxDevPct} onChange={(v) => set({ maxDevPct: v })} />
            <Num label="Max top 10 %" value={f.maxTop10Pct} onChange={(v) => set({ maxTop10Pct: v })} />
            <Num label="Max bundles %" value={f.maxBundlePct} onChange={(v) => set({ maxBundlePct: v })} />
            <label className="flex items-end gap-2 pb-1.5 text-xs text-text-2">
              <input type="checkbox" checked={f.socialsOnly} onChange={() => set({ socialsOnly: !f.socialsOnly })} className="h-4 w-4 accent-emerald" />
              Has social links
            </label>
          </div>

          <p className="mt-4 text-xs text-muted">Stage</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {STAGES.map((st) => {
              const on = f.stages.includes(st.key);
              return (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => set({ stages: on ? f.stages.filter((k) => k !== st.key) : [...f.stages, st.key] })}
                  aria-pressed={on}
                  title={st.key === "final" ? "Curve at 70% or more" : st.key === "graduated" ? "Curve complete" : "Still early on its curve"}
                  className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${on ? "border-emerald/40 text-emerald" : "border-border text-text-2 hover:text-text"}`}
                >
                  {st.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Text label="Name has any of" placeholder="cat, dog" value={f.include} onChange={(v) => set({ include: v })} />
            <Text label="Hide names with" placeholder="test, rug" value={f.exclude} onChange={(v) => set({ exclude: v })} />
          </div>

          <p className="mt-4 text-xs text-muted">Hidden devs {f.blockedDevs.length > 0 && <span className="font-mono">({f.blockedDevs.length})</span>}</p>
          {f.blockedDevs.length === 0 ? (
            <p className="mt-1 text-xs text-muted">Use the hide button on a card to hide every coin from that creator</p>
          ) : (
            <div className="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
              {f.blockedDevs.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => unblockDev(w)}
                  title={`Show coins from ${w} again`}
                  className="flex h-6 items-center gap-1 rounded-full border border-border px-2 font-mono text-[11px] text-text-2 hover:text-text"
                >
                  {shortAddress(w)}
                  <X size={11} strokeWidth={1.5} />
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-[11px] text-muted">Saved in this browser</p>
        </div>
      )}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
        placeholder="Any"
        className="h-8 rounded-md border border-border bg-surface px-2 font-mono text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
      />
    </label>
  );
}

function Text({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
      />
    </label>
  );
}
