"use client";
/* Kixo AI risk (gateway ai_risk.rs): the trained model's chance that a new coin dumps
   (falls 70%+) or doubles within the next hour, judged from its first 2 minutes.
   Cards ask for their own coin; one request every few seconds covers every card on the
   screen. A score is final once given, so scored coins are never asked again. */
import { useEffect, useSyncExternalStore } from "react";
import { GATEWAY_HTTP } from "./gateway";

export type AiRisk = { dump: number; pump: number; trades: number; at: number };

/** The model's window: a coin gets its score this long after its first trade. */
export const AI_WINDOW_S = 120;
const POLL_MS = 4_000;

const scores = new Map<string, AiRisk>();
const wanted = new Map<string, number>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let serviceOn = true;

async function poll() {
  const ask = [...wanted.keys()].filter((m) => !scores.has(m));
  if (!ask.length) return;
  let changed = false;
  for (let i = 0; i < ask.length; i += 150) {
    try {
      const r = await fetch(`${GATEWAY_HTTP}/ai/risk?mints=${ask.slice(i, i + 150).join(",")}`, { cache: "no-store" });
      if (!r.ok) return;
      const v = (await r.json()) as { on: boolean; risk: Record<string, AiRisk> };
      if (serviceOn !== v.on) {
        serviceOn = v.on;
        changed = true;
      }
      for (const [m, risk] of Object.entries(v.risk ?? {})) {
        scores.set(m, risk);
        changed = true;
      }
    } catch {
      return;
    }
  }
  if (changed) listeners.forEach((l) => l());
}

function want(mint: string) {
  wanted.set(mint, (wanted.get(mint) ?? 0) + 1);
  if (!timer) {
    timer = setInterval(poll, POLL_MS);
    void poll();
  }
  return () => {
    const n = (wanted.get(mint) ?? 1) - 1;
    if (n <= 0) wanted.delete(mint);
    else wanted.set(mint, n);
    if (!wanted.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** For engines outside React (the sniper's "Copy Kixo AI" rule): the score if known. */
export function aiScoreOf(mint: string): AiRisk | null {
  return serviceOn ? scores.get(mint) ?? null : null;
}

/** Asks for these coins' scores for the next 10 minutes, without a component on screen. */
const prefetched = new Set<string>();
export function aiPrefetch(mints: string[]) {
  for (const m of mints) {
    if (prefetched.has(m) || scores.has(m)) continue;
    prefetched.add(m);
    const release = want(m);
    setTimeout(() => {
      release();
      prefetched.delete(m);
    }, 600_000);
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The coin's AI score, once the model has judged it. */
export function useAiRisk(mint: string, enabled = true): AiRisk | null {
  useEffect(() => (enabled ? want(mint) : undefined), [mint, enabled]);
  return useSyncExternalStore(
    subscribe,
    () => (enabled && serviceOn ? scores.get(mint) ?? null : null),
    () => null,
  );
}

/** How the score reads: the dump chance leads, because avoiding a dump matters most. */
export function riskTone(r: AiRisk): "bad" | "good" | "muted" {
  const v = verdict(r).key;
  return v === "danger" ? "bad" : v === "good" ? "good" : "muted";
}

/** The AI's answer in one plain word, the same everywhere in Kixo. "Good odds" uses the
 *  same line as Copy Kixo AI (under 20% dump risk, 15%+ 2x odds). */
export type Verdict = { key: "danger" | "careful" | "calm" | "good"; label: string; sentence: string; className: string; dot: string };
export const VERDICTS: Record<Verdict["key"], Omit<Verdict, "key">> = {
  danger: { label: "Danger", sentence: "High chance it crashes in the next hour", className: "border-negative/40 bg-negative/10 text-negative", dot: "bg-negative" },
  careful: { label: "Careful", sentence: "Some chance it crashes in the next hour", className: "border-warning/40 bg-warning/10 text-warning", dot: "bg-warning" },
  calm: { label: "Calm", sentence: "Nothing stands out either way", className: "border-border text-text-2", dot: "bg-text-2" },
  good: { label: "Good odds", sentence: "Low crash risk and a real chance to double", className: "border-positive/40 bg-positive/10 text-positive", dot: "bg-positive" },
};
export function verdict(r: AiRisk): Verdict {
  const key: Verdict["key"] = r.dump >= 0.4 ? "danger" : r.dump >= 0.2 ? "careful" : r.pump >= 0.15 && r.dump < 0.2 ? "good" : "calm";
  return { key, ...VERDICTS[key] };
}

/** A model never knows for certain: tiny and huge chances read "<1%" and ">99%". */
export function pct(x: number) {
  if (x < 0.01) return "<1%";
  if (x > 0.99) return ">99%";
  return `${Math.round(x * 100)}%`;
}

export function riskTitle(r: AiRisk) {
  return `Kixo AI: ${verdict(r).label}. ${verdict(r).sentence}. From this coin's first 2 minutes (${r.trades} trades): ${pct(r.dump)} chance it falls a further 70% or more within the hour after, ${pct(
    r.pump,
  )} chance it doubles from there. Measured from the price at 2 minutes, so a coin that already crashed can read low. A model's estimate from past launches, not advice`;
}
