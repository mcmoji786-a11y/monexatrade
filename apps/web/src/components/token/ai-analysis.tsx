"use client";

import { useEffect, useState } from "react";
import { Sparkle, X } from "lucide-react";
import { analyze, type AnalysisInput, type AnalysisResult } from "@/lib/ai";
import { TokenLogo } from "./token-bits";

/** "AI" button on a coin. `compact` is the small table version. */
export function AiButton({ input, compact = false }: { input: () => AnalysisInput; compact?: boolean }) {
  const [open, setOpen] = useState<AnalysisInput | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(input());
        }}
        title="AI analysis"
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

function AiDialog({ input, onClose }: { input: AnalysisInput; onClose: () => void }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    analyze(input).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [input]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20"
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
        className="fade-up flex max-h-[80vh] w-full max-w-xl cursor-default flex-col overflow-hidden rounded-xl border border-border bg-surface text-left shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border p-5">
          <TokenLogo src={input.image} symbol={input.symbol} size={40} />
          <div className="min-w-0 flex-1">
            <h2 id="ai-title" className="flex items-center gap-2 text-base font-medium text-text">
              <Sparkle size={15} strokeWidth={1.5} className="text-cyan" />
              AI analysis
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
          {result?.status === "ok" ? (
            <div className="flex flex-col gap-4 text-sm">
              <p className="leading-6 text-text">{result.summary}</p>
              <Section title="Strengths" tone="text-positive" items={result.strengths} />
              <Section title="Risks" tone="text-negative" items={result.risks} />
              <Section title="What to watch" tone="text-warning" items={result.watch} />
            </div>
          ) : (
            <div className="rounded-lg border border-cyan/20 bg-cyan/5 p-4">
              <div className="text-sm font-medium text-text">{result ? "AI analysis is coming soon" : "Preparing"}</div>
              <p className="mt-1 text-sm leading-6 text-text-2">
                {result?.status === "error"
                  ? result.message
                  : "It will read this coin's live on-chain data below and explain its strengths, risks and what to watch, in plain words"}
              </p>
            </div>
          )}

          <h3 className="mt-5 text-xs text-muted">Data the analysis uses, live right now</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {input.facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[11px] text-muted">{f.label}</dt>
                <dd className="truncate font-mono text-xs text-text">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="border-t border-border px-5 py-3 text-[11px] text-muted">Not financial advice. Facts from on-chain data</div>
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
