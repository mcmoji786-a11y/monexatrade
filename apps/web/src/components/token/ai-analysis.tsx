"use client";
/* "AI analysis" on a coin (Discover, Sol Radar, trade page): Kixo AI's word for the coin,
   a written read from Kixo AI's language model (gateway ai_chat.rs) built only from the
   coin's live facts, Kixo's own checks, and a box to ask more about this coin. Without a
   model the read comes from Kixo's checks alone (lib/ai.ts quickRead). */
import { useFeatures } from "@/lib/features";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Loader2, Sparkle, X } from "lucide-react";
import { analyze, type AnalysisInput, type AnalysisResult } from "@/lib/ai";
import { askModel, looksSecret, plain, SECRET_REPLY } from "@/lib/ai-chat";
import { pct, useAiRisk, verdict, type AiRisk } from "@/lib/ai-risk";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "./token-bits";
import type { Safety } from "@/lib/safety";

/** "AI" button on a coin. `compact` is the small table version. */
function AiButtonInner({ input, compact = false, safety }: { input: () => AnalysisInput; compact?: boolean; safety?: Safety | null }) {
  const [open, setOpen] = useState<AnalysisInput | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen({ ...input(), safety });
        }}
        title="Kixo AI analysis"
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cyan/30 text-xs text-cyan transition-colors hover:bg-cyan/10 focus-visible:outline-2 focus-visible:outline-emerald ${
          compact ? "h-8 px-2.5" : "h-8 px-3"
        }`}
      >
        <Sparkle size={13} strokeWidth={1.5} />
        {compact ? "AI" : "AI analysis"}
      </button>
      {open && <AiDialog input={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The question sent to the model: the coin's live facts only, and the shape of the answer. */
function prompt(input: AnalysisInput, risk: AiRisk | null) {
  const facts = input.facts.map((f) => `${f.label}: ${f.value}`).join("; ");
  const s = input.safety;
  const flags = s ? s.factors.filter((f) => f.points < 0).slice(0, 6).map((f) => (f.detail ? `${f.label} (${f.detail})` : f.label)).join("; ") : "";
  const v = risk ? verdict(risk) : null;
  return [
    `Analyse the Solana coin ${input.symbol} (${input.name}), address ${input.mint}, for a trader deciding whether to look closer.`,
    `Live facts: ${facts}.`,
    s ? `Kixo safety score ${s.score}/100.${flags ? ` Flags: ${flags}.` : " No red flags."}` : "",
    v && risk ? `Kixo AI word: ${v.label} (crash chance ${pct(risk.dump)}, double chance ${pct(risk.pump)}, from its first 2 minutes).` : "",
    `Use only these facts and do not repeat the address. Answer in plain text, in this shape: one sentence overall read; then "Good:" with up to 3 short points; "Risks:" with up to 3 short points; "Watch:" with 2 short points.`,
  ]
    .filter(Boolean)
    .join("\n");
}

type Turn = { q: string; a: string[] };

function AiDialog({ input, onClose }: { input: AnalysisInput; onClose: () => void }) {
  const risk = useAiRisk(input.mint);
  const [rules, setRules] = useState<AnalysisResult | null>(null);
  const [read, setRead] = useState<string[] | null | "loading">("loading");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Kixo's own checks, always ready.
  useEffect(() => {
    let alive = true;
    analyze(input).then((r) => alive && setRules(r));
    return () => {
      alive = false;
    };
  }, [input]);

  // The model's read, once. The AI word is included when it is already known.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    askModel(prompt(input, risk), []).then((r) => setRead(r && "reply" in r ? plain(r.reply).split(/\n+/).map((l) => l.trim()).filter(Boolean) : null));
  }, [input, risk]);

  const follow = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setQ("");
    if (looksSecret(text)) {
      setTurns((t) => [...t, { q: "(hidden)", a: SECRET_REPLY.text }]);
      return;
    }
    setBusy(true);
    const history = [
      { role: "user" as const, content: prompt(input, risk) },
      { role: "assistant" as const, content: Array.isArray(read) ? read.join("\n") : "" },
      ...turns.flatMap((t) => [
        { role: "user" as const, content: t.q },
        { role: "assistant" as const, content: t.a.join("\n") },
      ]),
    ];
    const r = await askModel(`About ${input.symbol} (${input.mint}): ${text}`, history);
    const a = r && "reply" in r ? plain(r.reply).split(/\n+/).map((l) => l.trim()).filter(Boolean) : r && "refused" in r ? SECRET_REPLY.text : ["Kixo AI is busy right now. Try again in a minute"];
    setTurns((t) => [...t, { q: text, a }]);
    setBusy(false);
  };

  const v = risk ? verdict(risk) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-title"
        onClick={(e) => e.stopPropagation()}
        className="fade-up flex max-h-[85vh] w-full max-w-xl cursor-default flex-col overflow-hidden rounded-xl border border-border bg-surface text-left shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border p-5">
          <TokenLogo src={input.image} symbol={input.symbol} size={40} />
          <div className="min-w-0 flex-1">
            <h2 id="ai-title" className="flex items-center gap-2 text-base font-medium text-text">
              <Sparkle size={15} strokeWidth={1.5} className="text-cyan" />
              Kixo AI analysis
            </h2>
            <p className="truncate text-sm text-text-2">
              {input.symbol} · {input.name}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* The AI's word for new launches */}
          {v && risk ? (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg/60 px-4 py-3">
              <span className={`inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium ${v.className}`}>{v.label}</span>
              <span className="text-sm text-text-2">
                {v.sentence}
                <span className="ml-1 text-xs text-muted">
                  (crash {pct(risk.dump)}, double {pct(risk.pump)})
                </span>
              </span>
            </div>
          ) : null}

          {/* The written read */}
          {read === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-text-2">
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
              Kixo AI is reading this coin&apos;s live data
            </p>
          ) : read ? (
            <div className="flex flex-col gap-2 text-sm leading-6 text-text-2">
              {read.map((l, i) => {
                const m = l.match(/^(Good|Risks|Watch):\s*(.*)$/i);
                if (!m) return <p key={i} className={i === 0 ? "text-text" : ""}>{l}</p>;
                const tone = /good/i.test(m[1]) ? "text-positive" : /risk/i.test(m[1]) ? "text-negative" : "text-warning";
                return (
                  <p key={i}>
                    <span className={`mr-1.5 ${tone}`}>{m[1]}:</span>
                    {m[2]}
                  </p>
                );
              })}
            </div>
          ) : rules?.status === "ok" ? (
            <div className="flex flex-col gap-4 text-sm">
              <p className="leading-6 text-text">{rules.summary}</p>
              <Section title="Strengths" tone="text-positive" items={rules.strengths} />
              <Section title="Risks" tone="text-negative" items={rules.risks} />
              <Section title="What to watch" tone="text-warning" items={rules.watch} />
            </div>
          ) : (
            <p className="text-sm text-text-2">Kixo AI is busy right now. The live data is below</p>
          )}

          {/* Ask more about this coin */}
          {turns.map((t, i) => (
            <div key={i} className="mt-4 flex flex-col gap-2">
              <p className="self-end rounded-xl rounded-br-sm bg-surface-3 px-3 py-2 text-sm text-text">{t.q}</p>
              <div className="rounded-xl rounded-bl-sm border border-border bg-bg px-3 py-2 text-sm leading-6 text-text-2">
                {t.a.map((l, j) => (
                  <p key={j}>{l}</p>
                ))}
              </div>
            </div>
          ))}
          <form onSubmit={follow} className="mt-4 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Ask anything about ${input.symbol}`}
              aria-label={`Ask Kixo AI about ${input.symbol}`}
              maxLength={300}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
            />
            <button type="submit" disabled={busy || !q.trim()} aria-label="Ask" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-text text-bg transition-opacity disabled:opacity-40">
              {busy ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={1.5} />}
            </button>
          </form>

          <h3 className="mt-5 text-xs text-muted">Live data the analysis uses</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {input.facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[11px] text-muted">{f.label}</dt>
                <dd className="truncate font-mono text-xs text-text">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[11px] text-muted">
          <span>Kixo AI can be wrong. Not financial advice</span>
          <Link href={tokenHref(input.mint)} onClick={onClose} className="text-cyan hover:underline">
            Open chart
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className={`text-xs ${tone}`}>{title}</h3>
      <ul className="mt-1.5 flex flex-col gap-1 text-text-2">
        {items.map((x) => (
          <li key={x} className="flex gap-2">
            <span className={`mt-2 h-1 w-1 shrink-0 rounded-full bg-current ${tone}`} />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Hidden when the admin switches "ai_analysis" off (lib/features.ts). */
export function AiButton(props: { input: () => AnalysisInput; compact?: boolean; safety?: Safety | null }) {
  const f = useFeatures();
  return f.ai_analysis ? <AiButtonInner {...props} /> : null;
}
