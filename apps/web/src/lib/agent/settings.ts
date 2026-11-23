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

export type AlertKind = "dev" | "dump" | "whale" | "bundles" | "pump" | "position";

export const ALERTS: { key: AlertKind; label: string; line: string }[] = [
  { key: "dev", label: "Dev sells", line: "The creator sells any of their coins" },
  { key: "dump", label: "Heavy selling", line: "The price drops fast with sellers in control" },
  { key: "whale", label: "Whale exits", line: "A wallet sells a big amount for this coin at once (5 SOL or more, more on bigger coins)" },
  { key: "bundles", label: "Bundles selling", line: "Wallets that bought together at launch start selling" },
  { key: "position", label: "Your position", line: "Your position hits your stop or profit level" },
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
};

export const DEFAULTS: AgentSettings = {
  on: false,
  mode: "buddy",
  brief: true,
  emergencies: true,
  alerts: { dev: true, dump: true, whale: true, bundles: true, position: true, pump: false },
  ptt: "v",
  voice: "",
  speed: 0,
  volume: 0.9,
  micId: "",
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
