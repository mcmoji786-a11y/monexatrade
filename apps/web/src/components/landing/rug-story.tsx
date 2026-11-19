"use client";
/* Landing: how Kixo catches a rug, told in four scroll steps next to one coin card that
   follows them. The coin is an illustrative example (labelled), built from what Kixo
   really shows: bundle share, the AI's word after 2 minutes, the dev's sell and Rug exit. */
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { VERDICTS } from "@/lib/ai-risk";

const STEPS = [
  { t: "0:00", title: "A coin launches", body: "Sol Radar has it the moment its create transaction confirms, priced from the chain." },
  { t: "0:40", title: "Kixo sees who bought", body: "Six wallets bought in the same block: a bundle holding 34% of the supply, and two of the first buyers have dumped coins before." },
  { t: "2:00", title: "Kixo AI gives its word", body: "From the first 2 minutes of trades, the model puts the crash chance at 81%. It says Danger." },
  { t: "2:14", title: "The dev sells. Rug exit sells first", body: "The creator dumps 18 SOL. With Rug exit on, Kixo sells your demo position at once, before the bottom." },
] as const;

// Price path (0 to 100, higher is up) over the hour, sampled evenly. The dev sells at ~62%.
const PATH = [8, 10, 16, 22, 21, 30, 38, 36, 44, 52, 49, 58, 64, 61, 70, 74, 71, 78, 76, 80, 77, 74, 30, 22, 26, 18, 14, 16, 11, 9, 10, 7, 6, 7, 5, 5, 4, 5, 4, 4];
const W = 520;
const H = 160;
const points = PATH.map((v, i) => `${((i / (PATH.length - 1)) * W).toFixed(1)},${(H - (v / 100) * (H - 16) - 8).toFixed(1)}`).join(" ");
// How much of the line each step shows (share of the hour).
const SHOWN = [0.18, 0.38, 0.52, 1];

export function RugStory() {
  const [step, setStep] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const danger = VERDICTS.danger;
  return (
    <section id="ai" className="scroll-mt-20">
      <div className="mx-auto max-w-300 px-4 py-20 md:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-xs text-emerald">Kixo AI</p>
          <h2 className="mt-3 text-3xl font-medium leading-tight text-text md:text-4xl">How a rug gets caught in two minutes</h2>
          <p className="mt-4 text-base leading-7 text-text-2">Kixo trained its own model on 487,368 Solana launches. It reads who bought a coin early and how its first 2 minutes traded, then gives one word</p>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <div className="sticky top-16 z-10 self-start bg-bg pb-4 lg:top-24 lg:bg-transparent lg:pb-0">
            <CoinCard step={step} danger={danger} />
          </div>

          <ol className="flex flex-col gap-4 lg:py-10">
            {STEPS.map((s, n) => (
              <li
                key={s.t}
                ref={(el) => {
                  refs.current[n] = el;
                }}
                data-step={n}
                className={`rounded-xl border p-5 transition-[border-color,opacity] duration-300 lg:min-h-48 ${n === step ? "border-border bg-surface opacity-100" : "border-transparent opacity-50"}`}
              >
                <p className="font-mono text-xs text-muted">{s.t}</p>
                <h3 className="mt-2 text-lg font-medium text-text">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-text-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function CoinCard({ step, danger }: { step: number; danger: (typeof VERDICTS)["danger"] }) {
  const crashed = step >= 3;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex size-10 items-center justify-center rounded-full bg-surface-3 font-mono text-xs text-text-2">ZA</div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-text">$ZAP</p>
          <p className="font-mono text-xs text-muted">Zap Coin · pump.fun</p>
        </div>
        <div className="text-right font-mono">
          <p className={`text-base tabular-nums transition-colors duration-500 ${crashed ? "text-negative" : "text-text"}`}>{crashed ? "$2.1K" : step >= 1 ? "$31.4K" : "$6.2K"}</p>
          <p className="text-xs text-muted">market cap</p>
        </div>
      </div>

      <div className="px-5 pt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full sm:h-40" role="img" aria-label="Price over the first hour">
          {[0.25, 0.5, 0.75].map((y) => (
            <line key={y} x1="0" x2={W} y1={H * y} y2={H * y} stroke="currentColor" className="text-border" strokeWidth="1" />
          ))}
          <polyline
            points={points}
            fill="none"
            pathLength={100}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            stroke="currentColor"
            className={`transition-[stroke-dashoffset] duration-700 ${crashed ? "text-negative" : "text-positive"}`}
            style={{ strokeDasharray: 100, strokeDashoffset: 100 - SHOWN[step] * 100, transitionTimingFunction: "var(--mx-ease)" }}
          />
          {step >= 3 && <line x1={W * 0.55} x2={W * 0.55} y1="0" y2={H} stroke="currentColor" strokeDasharray="3 4" className="text-negative/60" />}
        </svg>
      </div>

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border text-sm">
        <Fact k="Bundle holds" v={step >= 1 ? "34%" : "—"} bad={step >= 1} />
        <Fact k="Early buyers who dumped before" v={step >= 1 ? "2 of 9" : "—"} bad={step >= 1} />
        <div className="col-span-2 flex items-center justify-between gap-4 bg-surface px-5 py-4">
          <dt className="text-muted">Kixo AI</dt>
          <dd className="flex items-center gap-2">
            {step >= 2 ? (
              <>
                <span className={`inline-flex h-6 items-center rounded-full border px-2 text-xs ${danger.className}`}>{danger.label}</span>
                <span className="font-mono text-xs text-text-2">crash 81%</span>
              </>
            ) : (
              <span className="font-mono text-xs text-muted">reading the first 2 minutes</span>
            )}
          </dd>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-4 bg-surface px-5 py-4">
          <dt className="text-muted">Your demo position</dt>
          <dd className="text-right">
            {crashed ? (
              <span className="flex items-center gap-2 text-text">
                <Check size={16} strokeWidth={1.5} className="text-positive" />
                Rug exit sold at <span className="font-mono tabular-nums text-negative">−6%</span>
              </span>
            ) : (
              <span className="font-mono text-xs text-text-2">$100 held</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border px-5 py-2.5 text-xs text-muted">
        <span>{crashed ? "One hour later the coin is down 92%" : "Illustrative example"}</span>
        {crashed && <span>Illustrative example</span>}
      </p>
    </div>
  );
}

function Fact({ k, v, bad }: { k: string; v: string; bad: boolean }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`mt-1 font-mono text-base tabular-nums transition-colors duration-500 ${bad ? "text-negative" : "text-text"}`}>{v}</dd>
    </div>
  );
}
