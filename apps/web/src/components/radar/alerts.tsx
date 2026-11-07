"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { useAlertPrefs, useWatchlist, type AlertPrefs } from "@/lib/prefs";
import type { RadarToken } from "./use-radar-feed";

/** Radar alerts: fires once per coin and event while this page is open. */
export function useRadarAlerts(tokens: RadarToken[], lowerRisk: Set<string>) {
  const { prefs } = useAlertPrefs();
  const watched = useWatchlist().mints;
  const fired = useRef(new Set<string>());
  const primed = useRef(false);

  useEffect(() => {
    if (!tokens.length) return;
    const events: { key: string; title: string; body: string }[] = [];
    for (const t of tokens) {
      const m = t.market;
      if (prefs.lowerRisk && lowerRisk.has(t.mint)) events.push({ key: `lr:${t.mint}`, title: `${t.symbol} is on the lower-risk list`, body: t.name });
      if (prefs.curve80 && m && !m.complete && m.curve_progress >= 80)
        events.push({ key: `c80:${t.mint}`, title: `${t.symbol} curve at ${m.curve_progress.toFixed(0)}%`, body: "Close to graduating" });
      if (prefs.devSells && m && m.dev_sells > 0 && watched.includes(t.mint))
        events.push({ key: `dev:${t.mint}:${m.dev_sold_all}`, title: `Dev is selling ${t.symbol}`, body: m.dev_sold_all ? "The dev sold everything" : `${m.dev_sells} dev sells` });
    }
    // The first pass only records what is already true, so opening the page is silent.
    const fresh = events.filter((e) => !fired.current.has(e.key));
    fresh.forEach((e) => fired.current.add(e.key));
    if (!primed.current) {
      primed.current = true;
      return;
    }
    if (!fresh.length) return;
    if (prefs.sound) beep();
    if (prefs.desktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const e of fresh.slice(0, 3)) new Notification(e.title, { body: e.body, tag: e.key });
    }
  }, [tokens, lowerRisk, prefs, watched]);
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch {
    // Audio blocked until the user interacts with the page.
  }
}

const OPTIONS: { key: keyof AlertPrefs; label: string }[] = [
  { key: "lowerRisk", label: "A coin passes every lower-risk check" },
  { key: "curve80", label: "A curve crosses 80%" },
  { key: "devSells", label: "Dev sells a starred coin" },
  { key: "sound", label: "Play a sound" },
  { key: "desktop", label: "Desktop notification" },
];

/** Bell in the Radar toolbar with the alert switches. */
export function AlertsMenu() {
  const { prefs, set } = useAlertPrefs();
  const [open, setOpen] = useState(false);
  const any = prefs.lowerRisk || prefs.curve80 || prefs.devSells;

  const toggle = async (key: keyof AlertPrefs) => {
    const next = !prefs[key];
    if (key === "desktop" && next && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      if ((await Notification.requestPermission()) !== "granted") return;
    }
    set({ [key]: next });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm transition-colors hover:bg-surface-2 ${any ? "text-text" : "text-muted"}`}
      >
        {any ? <BellRing size={14} strokeWidth={1.5} /> : <Bell size={14} strokeWidth={1.5} />}
        Alerts
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-border bg-surface-2 p-3 shadow-lg">
          <p className="text-xs text-muted">While this page is open. Telegram and Discord alerts come with Wallet Monitor</p>
          <div className="mt-2 flex flex-col">
            {OPTIONS.map((o) => (
              <label key={o.key} className="flex h-8 cursor-pointer items-center justify-between gap-3 text-sm text-text-2 hover:text-text">
                {o.label}
                <input type="checkbox" checked={prefs[o.key]} onChange={() => toggle(o.key)} className="h-4 w-4 accent-emerald" />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
