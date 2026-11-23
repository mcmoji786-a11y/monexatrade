"use client";
/* Kixo Agent on a coin page: a small dock that speaks a read of the coin when the page
   opens, watches the live trades and speaks up on its own when something dangerous
   happens, and answers questions by voice (hold the mic button or the push-to-talk key)
   or typed. Settings live in Kixo AI, Voice agent. */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Mic, Power, Settings2, Square } from "lucide-react";
import { useFeatures } from "@/lib/features";
import { inputFromRow } from "@/lib/ai";
import { useAiRisk } from "@/lib/ai-risk";
import { useDemo } from "@/lib/demo";
import type { FeedToken } from "@/lib/gateway";
import type { DiscoverRow } from "@/lib/categories";
import type { Safety } from "@/lib/safety";
import type { BookState } from "@/components/trade/use-token-book";
import { useLiveScan } from "@/components/token/live-scan";
import { freshScore, outlook, plan, scoreOf, useMarketForecast, useSimilar } from "@/components/token/ai-analysis";
import { MODES, setAgentSettings, useAgentSettings } from "@/lib/agent/settings";
import { answer, brief, Watcher, type CoinCtx } from "@/lib/agent/brain";
import { audioReady, micLevel, micProblem, onSpeech, remember, say, startListening, stopListening, stopSpeaking, unlockAudio, voiceStatus } from "@/lib/agent/voice";

type Props = { mint: string; row: DiscoverRow; launch: FeedToken | null; book: BookState; safety: Safety | null; solUsd: number | null };

/** Coins whose read was already spoken this visit: reopening a tab does not repeat it. */
const briefed = new Set<string>();

export function AgentDock(props: Props) {
  const f = useFeatures();
  const s = useAgentSettings();
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    voiceStatus().then((v) => alive && setReady(v.on && v.ready));
    return () => {
      alive = false;
    };
  }, []);
  if (!f.voice_agent || ready === false) return null;

  if (!s.on) {
    return (
      <button
        type="button"
        onClick={() => {
          unlockAudio();
          setAgentSettings({ on: true });
        }}
        className="fixed right-20 bottom-20 z-40 flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm text-text-2 shadow-lg transition-colors hover:text-text lg:bottom-5"
        title="Kixo Agent talks you through this coin"
      >
        <Power size={15} strokeWidth={1.5} />
        Kixo Agent
      </button>
    );
  }
  return <LiveAgent key={props.mint} {...props} />;
}

function LiveAgent({ mint, row, launch, book, safety, solUsd }: Props) {
  const s = useAgentSettings();
  const risk = useAiRisk(mint);
  const scan = useLiveScan(mint);
  const sim = useSimilar(risk);
  const num = useMemo(() => {
    const n = inputFromRow(row).num!;
    return { ...n, devSoldAll: launch?.market?.dev_sold_all ?? null };
  }, [row, launch]);
  const fresh = freshScore(num);
  const established = !risk || !fresh;
  const forecast = useMarketForecast(mint, established);
  const { mode, account } = useDemo();
  const pos = mode === "demo" ? account?.positions.find((p) => p.mint === mint) : undefined;

  const ctx: CoinCtx | null = useMemo(() => {
    const o = outlook(risk, safety, num.ageSecs);
    const buy = fresh ? scoreOf(sim) : null;
    const p = o ? plan(o.tone, risk, safety, num, buy, established ? (forecast.v?.chances ?? null) : null) : null;
    const m = launch?.market ?? null;
    return {
      symbol: row.symbol,
      ageSecs: num.ageSecs,
      mcUsd: row.mcUsd,
      liquidityUsd: row.liquidityUsd,
      holders: row.holders,
      change5m: row.change5m,
      change1h: row.change1h,
      buys1h: row.buys1h,
      sells1h: row.sells1h,
      top10Pct: row.top10Pct,
      devPct: row.devPct,
      sniperPct: row.sniperPct,
      market: m,
      devReport: launch?.dev_report ?? null,
      risk,
      safety,
      plan: p,
      buyScore: buy,
      findings: scan.findings,
      trades: book.status === "live" ? book.trades : [],
      solUsd,
      position: pos ? { costUsd: pos.cost_usd, valueUsd: pos.value_usd } : null,
    };
  }, [risk, safety, num, fresh, sim, established, forecast.v, launch, row, scan.findings, book, solUsd, pos]);

  // The read when the page opens: once the scan and the forecast are in (or after 5 s).
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  });
  const dataIn = scan.status !== "scanning" && forecast.done && (!risk || sim !== undefined);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 5000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!s.brief || briefed.has(mint) || !(dataIn || waited) || !ctxRef.current) return;
    const text = brief(ctxRef.current, s.mode);
    if (!text) return;
    briefed.add(mint);
    say(text);
  }, [mint, s.brief, s.mode, dataIn, waited]);

  // Live alerts from the trades, spoken without a button.
  const watcher = useRef<Watcher | null>(null);
  useEffect(() => {
    if (!s.emergencies || !ctx) return;
    if (!watcher.current) watcher.current = new Watcher(mint);
    for (const a of watcher.current.check(ctx, s, Date.now())) say(a.text, { urgent: a.urgent });
  }, [ctx, s, mint]);

  // Speech state for the caption.
  const [caption, setCaption] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [audioOk, setAudioOk] = useState(true);
  useEffect(
    () =>
      onSpeech((c, b) => {
        setCaption(c);
        setSpeaking(b);
        setAudioOk(audioReady());
      }),
    [],
  );

  // Questions: hold the mic button or the push-to-talk key, or type.
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  // While listening: how loud the mic is, so you can see it hears you.
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setLevel(micLevel()), 80);
    return () => {
      clearInterval(id);
      setLevel(0);
    };
  }, [listening]);
  const ask = (q: string) => {
    if (!q.trim() || !ctxRef.current) return;
    remember(q, "you");
    setHeard(q);
    say(answer(q, ctxRef.current, s.mode), { urgent: true });
  };
  // The mic's state lives in a ref: starting takes a moment (and the first time the browser
  // asks for permission), and a stop that comes before the start has finished must still
  // stop it, never leave it recording.
  const mic = useRef<"idle" | "starting" | "on" | "stopping">("idle");
  const stopAsked = useRef(false);
  const cutoff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const end = async () => {
    if (mic.current === "starting") {
      stopAsked.current = true;
      return;
    }
    if (mic.current !== "on") return;
    mic.current = "stopping";
    clearTimeout(cutoff.current);
    setListening(false);
    setThinking(true);
    const q = await stopListening();
    setThinking(false);
    mic.current = "idle";
    if (q) ask(q);
    else say(s.mode === "pro" ? "Didn't catch that." : "Sorry, I didn't catch that. Try again a bit closer to the mic.", { urgent: true });
  };
  const begin = async () => {
    if (mic.current !== "idle") return;
    unlockAudio();
    mic.current = "starting";
    stopAsked.current = false;
    const ok = await startListening();
    if (!ok) {
      mic.current = "idle";
      setMicError(micProblem);
      say("I can't hear you. Check the microphone, then try again.", { urgent: true });
      return;
    }
    setMicError(null);
    mic.current = "on";
    setListening(true);
    // Never record forever: a question is a few seconds.
    cutoff.current = setTimeout(() => void endRef.current(), 12_000);
    if (stopAsked.current) void end();
  };
  const toggle = () => (mic.current === "idle" ? void begin() : void end());
  const beginRef = useRef(begin);
  const endRef = useRef(end);
  useEffect(() => {
    beginRef.current = begin;
    endRef.current = end;
  });
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const match = (e: KeyboardEvent) => (s.ptt === "Alt" ? e.key === "Alt" : e.key.toLowerCase() === s.ptt);
    const down = (e: KeyboardEvent) => {
      if (e.repeat || typing(e) || !match(e)) return;
      e.preventDefault();
      void beginRef.current();
    };
    const up = (e: KeyboardEvent) => {
      if (!match(e)) return;
      void endRef.current();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [s.ptt]);
  useEffect(() => () => stopSpeaking(), []);

  const [typed, setTyped] = useState("");
  const modeLabel = MODES.find((m) => m.key === s.mode)?.label ?? "Buddy";
  const state = listening ? "Listening" : thinking ? "Thinking" : speaking ? "Speaking" : "Watching";

  return (
    <div className="fixed right-20 bottom-20 z-40 flex w-[min(380px,calc(100vw-6rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:bottom-5">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <Pulse on={speaking || listening} tone={listening ? "bg-cyan" : "bg-emerald"} />
        <span className="text-sm font-medium text-text">Kixo Agent</span>
        <span className="font-mono text-[11px] text-muted">
          {modeLabel} · {state}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {speaking && (
            <button type="button" onClick={stopSpeaking} aria-label="Stop talking" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text">
              <Square size={13} strokeWidth={1.5} />
            </button>
          )}
          <Link href="/ai?tab=voice" aria-label="Agent settings" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text">
            <Settings2 size={14} strokeWidth={1.5} />
          </Link>
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setAgentSettings({ on: false });
            }}
            aria-label="Turn Kixo Agent off"
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text"
          >
            <Power size={14} strokeWidth={1.5} />
          </button>
        </span>
      </div>
      <div className="min-h-14 px-3.5 py-2.5 text-sm leading-6">
        {heard && <p className="text-xs text-muted">You: {heard}</p>}
        {micError && <p className="text-xs text-warning">{micError}</p>}
        {listening && (
          <span className="mb-1 flex h-1.5 overflow-hidden rounded-full bg-surface-3" aria-label="Microphone level">
            <span className="h-full rounded-full bg-cyan transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </span>
        )}
        <p className={caption ? "text-text" : "text-text-2"}>{caption ?? (!audioOk ? "Click anywhere on the page to let me talk" : s.mode === "quiet" ? "Quiet mode: I'll only speak up if something dangerous happens" : listening ? "Listening. Click the mic again when you're done" : `Watching ${row.symbol} for you. Click the mic or hold ${s.ptt === "Alt" ? "Alt" : s.ptt.toUpperCase()} to ask anything`)}</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(typed);
          setTyped("");
        }}
        className="flex items-center gap-2 border-t border-border px-2.5 py-2"
      >
        <button
          type="button"
          onClick={toggle}
          aria-pressed={listening}
          aria-label={listening ? "Stop and send" : "Talk to Kixo Agent"}
          title={listening ? "Click to send" : "Click and talk, click again to send"}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${listening ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-border text-text-2 hover:text-text"}`}
        >
          {thinking ? <Loader2 size={15} strokeWidth={1.5} className="animate-spin" /> : <Mic size={15} strokeWidth={1.5} />}
        </button>
        <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 200))} placeholder={`Ask about ${row.symbol}`} aria-label="Ask Kixo Agent" className="h-9 min-w-0 flex-1 rounded-lg bg-bg px-3 text-sm text-text outline-none placeholder:text-muted" />
      </form>
    </div>
  );
}

/** The agent's live mark: three bars that move while it speaks or listens. */
function Pulse({ on, tone }: { on: boolean; tone: string }) {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`w-[3px] rounded-full ${tone} ${on ? "agent-bar" : "h-1.5 opacity-60"}`} style={on ? { animationDelay: `${i * 120}ms` } : undefined} />
      ))}
    </span>
  );
}
