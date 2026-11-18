"use client";
/* Landing: Kixo AI's latest real calls, read from the gateway (/ai/overview): the hero's
   "just called" card and the ticker under the hero. Nothing here is made up; with the AI
   service offline both stay hidden. */
import { useEffect, useState } from "react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { verdict, type AiRisk } from "@/lib/ai-risk";
import { useNow } from "@/components/radar/use-radar-feed";

type Call = { mint: string; symbol: string; name?: string; image?: string; dump: number; pump: number; at: number; mc_usd?: number };
type Overview = { riskiest?: Call[]; best?: Call[] };

function useCalls() {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${GATEWAY_HTTP}/ai/overview`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => alive && v && setO(v))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return o;
}

const asRisk = (c: Call): AiRisk => ({ dump: c.dump, pump: c.pump, trades: 0, at: c.at });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ago = (at: number, now: number) => {
  const s = Math.max(0, Math.round(now / 1000 - at));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

/** The AI's most recent Danger call, as a small card on the hero's Radar. */
export function JustCalled() {
  const o = useCalls();
  const now = useNow();
  const c = [...(o?.riskiest ?? [])].filter((x) => x.dump >= 0.4).sort((a, b) => b.at - a.at)[0];
  if (!c || !now) return null;
  const v = verdict(asRisk(c));
  return (
    <div className="fade-up w-72 rounded-xl border border-border bg-surface-2 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
      <p className="font-mono text-xs text-muted">Kixo AI · {ago(c.at, now)}</p>
      <div className="mt-3 flex items-center gap-3">
        <div className="size-9 shrink-0 overflow-hidden rounded-full border border-border bg-surface-3">
          {c.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{c.symbol}</p>
          <p className="font-mono text-xs text-text-2">crash chance {pct(c.dump)}</p>
        </div>
        <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs ${v.className}`}>{v.label}</span>
      </div>
    </div>
  );
}

/** A slow strip of the AI's latest real calls under the hero. Stops on hover. */
export function AiTicker() {
  const o = useCalls();
  // Only calls that say something: Danger, Careful or Good odds.
  const calls = [...(o?.riskiest ?? []).slice(0, 12), ...(o?.best ?? []).slice(0, 12)].filter((c) => verdict(asRisk(c)).key !== "calm").sort((a, b) => b.at - a.at);
  if (calls.length < 6) return null;
  const row = (key: string) => (
    <ul className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={key === "b"}>
      {calls.map((c) => {
        const v = verdict(asRisk(c));
        return (
          <li key={`${key}${c.mint}`} className="flex shrink-0 items-center gap-2 text-sm">
            <span className={`size-1.5 rounded-full ${v.dot}`} />
            <span className="text-text">{c.symbol}</span>
            <span className="font-mono text-xs text-muted">
              {v.label} · crash {pct(c.dump)}
            </span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="border-y border-border bg-surface">
      <div className="mx-auto flex max-w-300 items-center gap-6 px-4 md:px-8">
        <p className="flex h-12 shrink-0 items-center gap-2 font-mono text-xs text-text-2">
          <span className="size-1.5 rounded-full bg-emerald" />
          Kixo AI, latest calls
        </p>
        <div className="ticker-mask min-w-0 flex-1 overflow-hidden">
          <div className="ticker flex w-max">
            {row("a")}
            {row("b")}
          </div>
        </div>
      </div>
    </div>
  );
}
