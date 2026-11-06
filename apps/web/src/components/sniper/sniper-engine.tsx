"use client";

import { useFeatures } from "@/lib/features";
import { useEffect, useRef } from "react";
import { useRadarFeed } from "@/components/radar/use-radar-feed";
import { dropPosition, pnl, sniperStep, useSniper, type SniperEvent } from "@/lib/sniper";
import { orderError, placeOrder, useMode } from "@/lib/demo";
import { useAccount } from "@/lib/account";
import { launchSignals, safetyScore } from "@/lib/safety";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";

const STEP_MS = 2_000;

/** Mounted once in the app shell: runs the paper sniper on the live feed while
 *  MONEXA is open, whatever page the user is on, and announces every buy and sell. */
function SniperEngineInner() {
  const { settings, positions } = useSniper();
  const feed = useRadarFeed();
  const mode = useMode();
  const auth = useAccount();
  const demo = useRef(false);
  useEffect(() => {
    demo.current = mode === "demo" && auth.status === "signed-in";
  }, [mode, auth.status]);
  const latest = useRef(feed);
  const prefs = useRef(settings);
  useEffect(() => {
    latest.current = feed;
    prefs.current = settings;
  }, [feed, settings]);
  const active = settings.enabled || positions.some((p) => !p.exitTs);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const { tokens, markets, smart, solUsd } = latest.current;
      if (!tokens.length) return;
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t.symbol.trim().toUpperCase(), (counts.get(t.symbol.trim().toUpperCase()) ?? 0) + 1);
      const copied = (t: (typeof tokens)[number]) => (counts.get(t.symbol.trim().toUpperCase()) ?? 0) > 1;
      const nowSecs = Date.now() / 1000;
      const safetyOf = (t: (typeof tokens)[number]) =>
        safetyScore(launchSignals(t, markets[t.mint] ?? null, { copyOfReal: false, sameSymbol: copied(t), sameXAccount: false, smart: smart[t.mint] ?? 0, nowSecs })).score;
      const events = sniperStep(tokens, copied, solUsd, safetyOf);
      if (events.length) {
        announce(events, prefs.current, solUsd);
        if (demo.current) mirrorToDemo(events, solUsd);
      }
    }, STEP_MS);
    return () => clearInterval(id);
  }, [active]);

  return null;
}

function announce(events: SniperEvent[], s: { notifyToast: boolean; notifySound: boolean; notifyDesktop: boolean }, solUsd: number | null) {
  for (const e of events.slice(0, 4)) {
    const p = e.position;
    const usd = (sol: number) => (solUsd ? ` ($${Math.abs(sol * solUsd).toFixed(2)})` : "");
    let title: string;
    let body: string;
    let tone: "good" | "bad" | "info";
    if (e.kind === "buy") {
      title = `Sniper bought ${p.symbol || "a coin"}`;
      body = `${p.sizeSol.toFixed(3)} SOL${usd(p.sizeSol)} · MC ${p.entryMcSol.toFixed(1)} SOL${p.entrySafety != null ? ` · safety ${p.entrySafety}%` : ""}`;
      tone = "info";
    } else {
      const r = pnl(p, null);
      const win = (r.sol ?? 0) >= 0;
      title = `Sniper sold ${p.symbol || "a coin"} · ${p.reason}`;
      body = `${win ? "+" : "−"}${Math.abs(r.sol ?? 0).toFixed(3)} SOL${usd(r.sol ?? 0)} · ${r.pct != null ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(0)}%` : ""}`;
      tone = win ? "good" : "bad";
    }
    if (s.notifyToast) pushToast({ tone, title, body, href: tokenHref(p.mint) });
    if (s.notifyDesktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(`MONEXA · ${title}`, { body: `${body} (paper)`, tag: `${p.id}:${e.kind}` });
      n.onclick = () => {
        window.focus();
        window.location.assign(tokenHref(p.mint));
      };
    }
  }
  if (s.notifySound) chime(events.some((e) => e.kind === "buy"));
}

/** In demo mode every sniper buy and sell is also a real demo order, so the demo
 *  account's balance and P&L include the sniper (filled at live prices, with fees). */
function mirrorToDemo(events: SniperEvent[], solUsd: number | null) {
  for (const e of events) {
    const p = e.position;
    const order =
      e.kind === "buy"
        ? solUsd
          ? placeOrder({ mint: p.mint, side: "buy", usd: p.sizeSol * solUsd, source: "sniper" })
          : Promise.reject(new Error("SOL price not loaded"))
        : placeOrder({ mint: p.mint, side: "sell", fraction: 1, source: "sniper" });
    order.catch((err) => {
      if (e.kind === "buy") dropPosition(p.id);
      pushToast({ tone: "bad", title: `Sniper demo ${e.kind} not filled: ${p.symbol || "coin"}`, body: orderError(err) });
    });
  }
}

/** A short two-note chime: rising for a buy, falling for a sell. */
function chime(buy: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = buy ? [660, 880] : [660, 440];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.12;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {
    // Audio blocked until the user interacts with the page.
  }
}

/** Hidden when the admin switches "sniper" off (lib/features.ts). */
export function SniperEngine(props: Record<string, never>) {
  const f = useFeatures();
  return f.sniper ? <SniperEngineInner {...props} /> : null;
}
