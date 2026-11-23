"use client";
/* Kixo Agent settings, per viewer (this browser): on or off, the mode (how it talks),
   which alerts it speaks on its own, the push-to-talk key, voice, speed and volume. Kept
   in localStorage as a convenience; the agent works with the defaults when storage is
   blocked. Shared by the trade page dock and the Voice agent tab. */
import { useSyncExternalStore } from "react";

export type AgentMode = "buddy" | "coach" | "pro" | "degen" | "quiet";

export const MODES: { key: AgentMode; label: string; line: string; voice: string; speed: number }[] = [
  { key: "buddy", label: "Buddy", line: "Casual and friendly, like a trader friend next to you", voice: "am_michael", speed: 1.05 },
  { key: "coach", label: "Coach", line: "Explains everything in simple words. Best if you are new", voice: "af_heart", speed: 0.98 },
  { key: "pro", label: "Pro", line: "Short and sharp: the call and the numbers, nothing else", voice: "bm_george", speed: 1.12 },
  { key: "degen", label: "Degen", line: "Trader slang and a bit of fun, still honest about risk", voice: "am_fenrir", speed: 1.1 },
  { key: "quiet", label: "Quiet", line: "Says nothing unless something dangerous happens", voice: "am_michael", speed: 1.05 },
];

export const VOICES: { key: string; label: string }[] = [
  { key: "am_michael", label: "Michael (US)" },
  { key: "af_heart", label: "Heart (US)" },
  { key: "bm_george", label: "George (UK)" },
  { key: "af_bella", label: "Bella (US)" },
  { key: "am_adam", label: "Adam (US)" },
  { key: "bf_emma", label: "Emma (UK)" },
  { key: "am_fenrir", label: "Fenrir (US)" },
  { key: "af_nicole", label: "Nicole (US)" },
];

export type AlertKind = "dev" | "bundles" | "snipers" | "crowd" | "dump" | "whale" | "pump" | "position" | "setup" | "fading" | "mytrades";

export const ALERTS: { key: AlertKind; label: string; line: string }[] = [
  { key: "dev", label: "Dev sells", line: "The creator sells any of their coins: the second it happens" },
  { key: "bundles", label: "Bundles selling", line: "Wallets that bought together at launch start selling, often the dev's own" },
  { key: "snipers", label: "Snipers selling", line: "Bots that bought in the first seconds start dumping" },
  { key: "crowd", label: "Everyone selling", line: "Many different wallets sell at once and sellers swamp buyers" },
  { key: "dump", label: "Heavy selling", line: "The price drops fast with sellers in control" },
  { key: "whale", label: "Whale exits", line: "A wallet sells a big amount for this coin at once (5 SOL or more, more on bigger coins)" },
  { key: "setup", label: "Scalp setups", line: "Kixo AI sees a good chance of a quick +20% in the next two minutes" },
  { key: "fading", label: "Momentum fading", line: "You hold it and the next minutes look weak: time to take profit" },
  { key: "mytrades", label: "Your trades", line: "Talks you through every buy and sell you make, and the ones your take profit or stop loss make" },
  { key: "position", label: "Your position", line: "Tells you when your coin is up 20, 50 or 100 percent (is it enough?) or down 10 or 25 percent" },
  { key: "pump", label: "Big moves up", line: "The price jumps fast (not an emergency, off by default)" },
];

export type PttKey = "v" | "t" | "`" | "Alt";

export type AgentSettings = {
  on: boolean;
  mode: AgentMode;
  /** A spoken read of the coin when its page opens. */
  brief: boolean;
  /** Alerts the agent speaks on its own, without a button. */
  emergencies: boolean;
  alerts: Record<AlertKind, boolean>;
  /** Hold this key (outside text fields) to talk; the mic button always works too. */
  ptt: PttKey;
  /** Empty: the mode's voice. */
  voice: string;
  /** 0: the mode's speed. */
  speed: number;
  volume: number;
  /** The microphone to listen with (a device id); empty: the browser's default. */
  micId: string;
  /** A short beep before an emergency line, the moment it happens. */
  beep: boolean;
};

export const DEFAULTS: AgentSettings = {
  on: false,
  mode: "buddy",
  brief: true,
  emergencies: true,
  alerts: { dev: true, bundles: true, snipers: true, crowd: true, dump: true, whale: true, position: true, pump: false, setup: true, fading: true, mytrades: true },
  ptt: "v",
  voice: "",
  speed: 0,
  volume: 0.9,
  micId: "",
  beep: true,
};

const KEY = "kixo.agent.v1";
const listeners = new Set<() => void>();
let current: AgentSettings | null = null;

function read(): AgentSettings {
  if (current) return current;
  let saved: Partial<AgentSettings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AgentSettings>;
  } catch {
    saved = {};
  }
  current = { ...DEFAULTS, ...saved, alerts: { ...DEFAULTS.alerts, ...(saved.alerts ?? {}) } };
  return current;
}

export function agentSettings(): AgentSettings {
  return typeof window === "undefined" ? DEFAULTS : read();
}

export function setAgentSettings(patch: Partial<AgentSettings>) {
  current = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage blocked: the change lasts for this visit
  }
  listeners.forEach((l) => l());
}

export function useAgentSettings(): AgentSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => DEFAULTS,
  );
}

/** The voice and speed the agent speaks with: the user's choice, else the mode's. */
export function voiceOf(s: AgentSettings) {
  const m = MODES.find((x) => x.key === s.mode) ?? MODES[0];
  return { voice: s.voice || m.voice, speed: s.speed || m.speed };
}
