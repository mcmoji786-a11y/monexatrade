"use client";
/* Kixo AI, Voice agent: how Kixo Agent talks and when. Mode (how it talks), the read on
   opening a coin, the alerts it speaks on its own, the push-to-talk key, voice, speed and
   volume, with a sample to hear each choice, and what was said recently. */
import { useEffect, useState } from "react";
import { Play, Power } from "lucide-react";
import { useFeatures } from "@/lib/features";
import { ALERTS, MODES, VOICES, setAgentSettings, useAgentSettings, voiceOf, type AgentMode, type PttKey } from "@/lib/agent/settings";
import { history, say, stopSpeaking, unlockAudio, voiceStatus } from "@/lib/agent/voice";

/** What each mode sounds like on the same coin. */
const SAMPLES: Record<AgentMode, string> = {
  buddy: "Honestly, I'd stay away from this one. The main thing is the dev already sold everything, and bundled wallets still hold 18 percent.",
  coach: "My advice is simple: don't buy this coin right now. The creator already sold everything. When the creator sells out, there's usually no one left to push the price.",
  pro: "Avoid. Dev sold everything. Bundles hold 18 percent.",
  degen: "Nah, this one smells like exit liquidity. Dev already dumped and the bundles are still holding 18 percent. Hard pass.",
  quiet: "Warning. The dev just sold everything, about 4 thousand dollars.",
};

const KEYS: { key: PttKey; label: string }[] = [
  { key: "v", label: "V" },
  { key: "t", label: "T" },
  { key: "`", label: "` (backtick)" },
  { key: "Alt", label: "Alt" },
];

export function VoiceAgentTab() {
  const f = useFeatures();
  const s = useAgentSettings();
  const [status, setStatus] = useState<{ on: boolean; ready: boolean } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    voiceStatus().then((v) => alive && setStatus(v));
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const hear = (text: string) => {
    unlockAudio();
    say(text, { urgent: true });
  };

  if (!f.voice_agent || (status && !status.on)) {
    return <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted">Kixo Agent is switched off right now</p>;
  }
  const { voice, speed } = voiceOf(s);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-6">
        {/* On or off */}
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-5">
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-text">Kixo Agent</p>
            <p className="mt-1 text-sm leading-6 text-text-2">
              A voice that watches the coin you open. It tells you right away if it&apos;s worth buying, speaks up on its own when something dangerous happens, and answers your questions. English only for now
            </p>
            {status && !status.ready && <p className="mt-2 text-xs text-warning">The voice engine is starting. Try again in a minute</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              if (s.on) stopSpeaking();
              setAgentSettings({ on: !s.on });
            }}
            aria-pressed={s.on}
            className={`flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors ${s.on ? "border border-emerald/40 text-emerald hover:bg-surface-2" : "bg-text text-bg hover:opacity-90"}`}
          >
            <Power size={15} strokeWidth={1.5} />
            {s.on ? "On" : "Turn on"}
          </button>
        </section>

        {/* Mode */}
        <section>
          <h2 className="text-sm font-medium text-text">How it talks</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Agent mode">
            {MODES.map((m) => {
              const on = s.mode === m.key;
              return (
                <div key={m.key} className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${on ? "border-emerald/40 bg-surface-2" : "border-border bg-surface hover:bg-surface-2"}`}>
                  <button type="button" role="radio" aria-checked={on} onClick={() => setAgentSettings({ mode: m.key, voice: "", speed: 0 })} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-2 text-sm text-text">
                      <span className={`h-2 w-2 rounded-full ${on ? "bg-emerald" : "bg-surface-3"}`} aria-hidden="true" />
                      {m.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-text-2">{m.line}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAgentSettings({ mode: m.key, voice: "", speed: 0 });
                      hear(SAMPLES[m.key]);
                    }}
                    aria-label={`Hear ${m.label}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-text-2 hover:text-text"
                  >
                    <Play size={13} strokeWidth={1.5} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* What it says on its own */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-text">What it says without a button</h2>
          <div className="mt-4 flex flex-col divide-y divide-border">
            <Toggle label="A quick read when you open a coin" line="Buy, wait or stay away, why, and how much to risk" on={s.brief && s.mode !== "quiet"} disabled={s.mode === "quiet"} onChange={(v) => setAgentSettings({ brief: v })} />
            <Toggle label="Emergency alerts" line="It speaks up by itself when something dangerous happens on the coin you're watching" on={s.emergencies} onChange={(v) => setAgentSettings({ emergencies: v })} />
            {s.emergencies &&
              ALERTS.map((a) => (
                <Toggle key={a.key} sub label={a.label} line={a.line} on={s.alerts[a.key]} onChange={(v) => setAgentSettings({ alerts: { ...s.alerts, [a.key]: v } })} />
              ))}
          </div>
        </section>

        {/* Talking to it */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-text">Asking it something</h2>
          <p className="mt-1 text-xs leading-5 text-text-2">Hold the mic button on a coin page, or hold this key, and talk. Let go and it answers. You can also type</p>
          <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Push-to-talk key">
            {KEYS.map((k) => (
              <button
                key={k.key}
                type="button"
                role="radio"
                aria-checked={s.ptt === k.key}
                onClick={() => setAgentSettings({ ptt: k.key })}
                className={`h-9 rounded-lg border px-3 font-mono text-sm transition-colors ${s.ptt === k.key ? "border-emerald/40 bg-surface-2 text-text" : "border-border text-text-2 hover:text-text"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Try: &quot;Should I buy?&quot;, &quot;Did the dev sell?&quot;, &quot;How many holders?&quot;, &quot;How many trades?&quot;, &quot;Am I up?&quot;, &quot;What are bundles?&quot;</p>
        </section>

        {/* Voice */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-text">Voice</h2>
            <button type="button" onClick={() => hear("This is how I'll sound when I watch a coin for you.")} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-2 hover:text-text">
              <Play size={12} strokeWidth={1.5} />
              Test
            </button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Voice
              <select value={voice} onChange={(e) => setAgentSettings({ voice: e.target.value })} className="h-9 rounded-lg border border-border bg-bg px-2 text-sm text-text outline-none focus:border-emerald/50">
                {VOICES.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              <span className="flex justify-between">
                Speed <span className="font-mono text-text-2">{speed.toFixed(2)}x</span>
              </span>
              <input type="range" min={0.85} max={1.3} step={0.05} value={speed} onChange={(e) => setAgentSettings({ speed: Number(e.target.value) })} className="h-9 accent-emerald" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              <span className="flex justify-between">
                Volume <span className="font-mono text-text-2">{Math.round(s.volume * 100)}%</span>
              </span>
              <input type="range" min={0.2} max={1} step={0.05} value={s.volume} onChange={(e) => setAgentSettings({ volume: Number(e.target.value) })} className="h-9 accent-emerald" />
            </label>
          </div>
        </section>
      </div>

      {/* What was said */}
      <aside className="flex flex-col gap-3">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-text">Recently said</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-xs leading-5 text-muted">Open a coin with the agent on, and what it says shows up here</p>
          ) : (
            <ul className="mt-3 flex max-h-[520px] flex-col gap-3 overflow-y-auto">
              {history.slice(0, 30).map((h, i) => (
                <li key={`${h.at}-${i}`} className="text-sm leading-6">
                  <span className="font-mono text-[11px] text-muted">
                    {h.who === "you" ? "You" : "Agent"} · {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <p className={h.who === "you" ? "text-text-2" : "text-text"}>{h.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="px-1 text-xs leading-5 text-muted">
          Kixo Agent runs on Kixo&apos;s own voice engine. Your question is turned into text on Kixo&apos;s servers and is not stored. It reads the coin&apos;s live data and Kixo AI, and it can be wrong. Not financial advice
        </p>
      </aside>
    </div>
  );
}

function Toggle({ label, line, on, onChange, disabled, sub }: { label: string; line: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; sub?: boolean }) {
  return (
    <label className={`flex items-center gap-4 py-3 ${sub ? "pl-5" : ""} ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span className="min-w-0 flex-1">
        <span className={`block ${sub ? "text-xs" : "text-sm"} text-text`}>{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-text-2">{line}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 accent-emerald" />
    </label>
  );
}
