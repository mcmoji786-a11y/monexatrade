"use client";
/* Kixo Agent's mouth and ears in the browser. Speech comes from Kixo's own voice service
   through the gateway (/voice/tts, Kokoro on Kixo's GPU) and questions go to /voice/stt
   (Whisper): no browser speech and no outside service.

   A reply is spoken sentence by sentence: the next sentence is made while the current
   one plays, so the agent starts talking within a moment. An urgent line (an emergency)
   cuts in at once. Audio plays through one AudioContext, unlocked by the click that turns
   the agent on (browsers allow sound only after a user gesture). */
import { GATEWAY_HTTP } from "@/lib/gateway";
import { agentSettings, voiceOf } from "./settings";

type Line = { text: string; urgent: boolean };
type Listener = (caption: string | null, speaking: boolean) => void;

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let playing: AudioBufferSourceNode | null = null;
let queue: { text: string; audio: Promise<AudioBuffer | null> }[] = [];
let generation = 0;
let busy = false;
let caption: string | null = null;
const listeners = new Set<Listener>();
/** Lines spoken recently, newest first, for the transcript. */
export const history: { at: number; text: string; who: "agent" | "you" }[] = [];

function emit() {
  listeners.forEach((l) => l(caption, busy));
}

export function onSpeech(l: Listener) {
  listeners.add(l);
  l(caption, busy);
  return () => {
    listeners.delete(l);
  };
}

export function remember(text: string, who: "agent" | "you") {
  history.unshift({ at: Date.now(), text, who });
  if (history.length > 60) history.pop();
}

/** Call from a click or key press: browsers allow sound only after one. */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      gain = ctx.createGain();
      gain.connect(ctx.destination);
      ctx.onstatechange = () => emit();
    }
    if (ctx.state === "suspended") void ctx.resume().then(emit);
  } catch {
    ctx = null;
  }
}

let waitingForGesture = false;

/** With the agent already on from an earlier visit, the page has had no click yet: the
 *  audio waits (lines queue up) and starts on the first click or key press. */
function ensureAudio() {
  unlockAudio();
  if (ctx && ctx.state !== "running" && !waitingForGesture && typeof window !== "undefined") {
    waitingForGesture = true;
    const go = () => {
      waitingForGesture = false;
      unlockAudio();
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
    };
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  }
}

export function audioReady() {
  return !!ctx && ctx.state === "running";
}

/** Sentences short enough to start fast, long enough to sound natural. */
function sentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.length < 40) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  return out;
}

/** Lines already made, ready to play at once (alerts are made ahead: see preload). */
const ready = new Map<string, AudioBuffer>();
const making = new Map<string, Promise<AudioBuffer | null>>();

async function make(text: string): Promise<AudioBuffer | null> {
  if (!ctx) return null;
  const { voice, speed } = voiceOf(agentSettings());
  const key = `${voice}|${speed}|${text}`;
  const hit = ready.get(key);
  if (hit) return hit;
  const inFlight = making.get(key);
  if (inFlight) return inFlight;
  const p = (async () => {
    try {
      const r = await fetch(`${GATEWAY_HTTP}/voice/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice, speed }),
      });
      if (!r.ok || !ctx) return null;
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      ready.set(key, buf);
      if (ready.size > 300) ready.delete(ready.keys().next().value as string);
      return buf;
    } catch {
      return null;
    } finally {
      making.delete(key);
    }
  })();
  making.set(key, p);
  return p;
}

async function synth(text: string, gen: number): Promise<AudioBuffer | null> {
  const buf = await make(text);
  return gen === generation ? buf : null;
}

/** Makes lines ahead of time (the alert phrases), so they play the instant they are needed. */
export function preload(lines: string[]) {
  ensureAudio();
  for (const l of lines) void make(l);
}

/** A sharp two-tone beep, made in the browser: no network, no wait. */
export function beep() {
  ensureAudio();
  if (!ctx || !gain) return;
  const t = ctx.currentTime;
  for (const [i, f] of [[0, 1320], [1, 990]] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.13);
    g.gain.exponentialRampToValueAtTime(0.25 * agentSettings().volume, t + i * 0.13 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.13 + 0.11);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t + i * 0.13);
    o.stop(t + i * 0.13 + 0.12);
  }
}

async function pump() {
  if (busy || !ctx || !gain) return;
  busy = true;
  const gen = generation;
  while (queue.length && gen === generation) {
    const item = queue.shift()!;
    // The sentence after this one is made while this one plays.
    const audio = await item.audio;
    if (gen !== generation) break;
    if (!audio) continue;
    caption = item.text;
    emit();
    gain.gain.value = agentSettings().volume;
    await new Promise<void>((done) => {
      const src = ctx!.createBufferSource();
      src.buffer = audio;
      src.connect(gain!);
      src.onended = () => done();
      playing = src;
      src.start();
    });
    playing = null;
  }
  busy = false;
  if (gen === generation) {
    caption = null;
    emit();
  }
}

/** Stops whatever is being said and drops what was waiting. */
export function stopSpeaking() {
  generation++;
  queue = [];
  try {
    playing?.stop();
  } catch {
    // already stopped
  }
  playing = null;
  busy = false;
  caption = null;
  emit();
}

/** Says a line. `urgent` cuts in at once; otherwise it waits its turn, and a long
 *  backlog of ordinary lines is trimmed so the agent never talks about old news. */
export function say(text: string, opts: { urgent?: boolean } = {}) {
  const line: Line = { text: text.trim(), urgent: !!opts.urgent };
  ensureAudio();
  if (!line.text || !ctx) return;
  if (line.urgent) stopSpeaking();
  else if (queue.length > 4) queue = queue.slice(-2);
  remember(line.text, "agent");
  const gen = generation;
  for (const s of sentences(line.text)) queue.push({ text: s, audio: synth(s, gen) });
  void pump();
}

export function isSpeaking() {
  return busy;
}

/* ---------------- Listening ---------------- */

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let meter: AnalyserNode | null = null;
let meterCtx: AudioContext | null = null;
/** Why the last start failed, in words for the user. */
export let micProblem: string | null = null;

/** How loud the microphone is right now, 0 to 1 (0 when not listening). */
export function micLevel(): number {
  if (!meter) return 0;
  const data = new Uint8Array(meter.fftSize);
  meter.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += ((v - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / data.length) * 4);
}

/** The microphones this browser can use (names show once the mic was allowed). */
export async function microphones(): Promise<{ id: string; label: string }[]> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

/** Starts recording a question (push to talk). False when the mic is not allowed. */
export async function startListening(): Promise<boolean> {
  if (recorder) return true;
  try {
    const id = agentSettings().micId;
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { exact: id } } : {}) };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      // The chosen mic was unplugged: fall back to the default one.
      if (id && (e as Error).name === "OverconstrainedError") stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      else throw e;
    }
    micProblem = null;
    try {
      meterCtx = new AudioContext();
      meter = meterCtx.createAnalyser();
      meter.fftSize = 512;
      meterCtx.createMediaStreamSource(stream).connect(meter);
    } catch {
      meter = null;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start();
    stopSpeaking();
    return true;
  } catch (e) {
    recorder = null;
    const name = (e as Error).name;
    micProblem =
      name === "NotAllowedError"
        ? "The microphone is blocked for Kixo. Click the lock icon next to the address, allow the microphone, and try again"
        : name === "NotFoundError"
          ? "No microphone found. Plug one in, or pick another in Kixo AI, Voice agent"
          : "The microphone could not start. Pick another one in Kixo AI, Voice agent";
    return false;
  }
}

/** Stops recording and returns what was said ("" when nothing was heard). */
export async function stopListening(): Promise<string> {
  const r = recorder;
  if (!r) return "";
  recorder = null;
  const blob = await new Promise<Blob>((done) => {
    r.onstop = () => done(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
    r.stop();
  });
  r.stream.getTracks().forEach((t) => t.stop());
  meter = null;
  void meterCtx?.close();
  meterCtx = null;
  if (blob.size < 1500) return "";
  try {
    const res = await fetch(`${GATEWAY_HTTP}/voice/stt`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: blob });
    if (!res.ok) return "";
    const v = (await res.json()) as { text?: string };
    return (v.text ?? "").trim();
  } catch {
    return "";
  }
}

export function isListening() {
  return !!recorder;
}

/** Asks Kixo Brain (gateway /agent/ask): the question with the page's context. Null when
 *  no model answered in time (the caller answers from Kixo's own rules). */
export async function askBrain(question: string, mint: string, mode: string, app: unknown, history: { role: "user" | "assistant"; content: string }[]): Promise<string | null> {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/agent/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, mint, mode, app, history }),
      signal: AbortSignal.timeout(15_000),
    });
    const v = (await r.json()) as { reply?: string };
    return v.reply?.trim() || null;
  } catch {
    return null;
  }
}

/** Reads a coin's data into Kixo Brain ahead of a question (its prompt cache). */
export function warmBrain(mint: string, mode: string) {
  void fetch(`${GATEWAY_HTTP}/agent/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "", mint, mode, prefill: true }),
  }).catch(() => {});
}

/** Whether Kixo's voice service is up (admin switch on and the service answering). */
export async function voiceStatus(): Promise<{ on: boolean; ready: boolean }> {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/voice/health`, { cache: "no-store" });
    const v = (await r.json()) as { on?: boolean; ready?: boolean };
    return { on: !!v.on, ready: !!v.ready };
  } catch {
    return { on: false, ready: false };
  }
}
