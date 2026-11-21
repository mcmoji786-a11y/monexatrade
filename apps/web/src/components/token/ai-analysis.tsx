"use client";
/* "AI analysis" on a coin (Discover, Sol Radar, trade page): Kixo AI's word for the coin,
   a written read from Kixo AI's language model (gateway ai_chat.rs) built only from the
   coin's live facts, Kixo's own checks, and a box to ask more about this coin. Without a
   model the read comes from Kixo's checks alone (lib/ai.ts quickRead). */
import { useFeatures } from "@/lib/features";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, Loader2, Sparkle, X } from "lucide-react";
import { analyze, type AnalysisInput, type AnalysisResult, type Numbers } from "@/lib/ai";
import { usd } from "@/lib/gateway";
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

type Tone = "bad" | "warn" | "good" | "muted";
const TONE: Record<Tone, string> = {
  bad: "border-negative/30 text-negative",
  warn: "border-warning/30 text-warning",
  good: "border-positive/30 text-positive",
  muted: "border-border text-text",
};

/** Kixo's own outlook and call for a coin, worked out in code so they are always clear and
 *  never contradict the data: the AI model's chances for a new launch, otherwise the
 *  safety score from Kixo's checks. */
export function outlook(risk: AiRisk | null, safety: Safety | null | undefined, ageSecs: number | null = null) {
  if (risk) {
    const v = verdict(risk);
    const call: [Tone, string] =
      v.key === "danger"
        ? ["bad", "Stay away. Most coins the AI calls Danger crash within the hour"]
        : v.key === "careful"
          ? ["warn", "Tiny size only, tight stop. Real crash risk"]
          : v.key === "good"
            ? ["good", "Cleaner than most, still risky. Small size and a stop loss"]
            : ["muted", "Nothing special either way. Skip it, or go tiny"];
    return {
      tone: (v.key === "danger" ? "bad" : v.key === "careful" ? "warn" : v.key === "good" ? "good" : "muted") as Tone,
      word: v.label,
      headline: `${pct(risk.dump)} chance it crashes 70%+ in the next hour, ${pct(risk.pump)} chance it doubles`,
      source: "Kixo AI, from this coin's first 2 minutes of trades",
      call,
    };
  }
  if (safety) {
    const worst = safety.factors.filter((f) => f.points < 0).sort((a, b) => a.points - b.points).slice(0, 2).map((f) => (f.detail ? `${f.label} (${f.detail})` : f.label));
    const level = safety.score >= 75 ? "Lower risk" : safety.score >= 50 ? "Medium risk" : "High risk";
    const tone: Tone = safety.score >= 75 ? "good" : safety.score >= 50 ? "warn" : "bad";
    const call: [Tone, string] =
      safety.score >= 75 ? ["good", "Cleaner than most, still risky. Small size and a stop loss"] : safety.score >= 50 ? ["warn", "Tiny size only, tight stop"] : ["bad", "Stay away. Too many red flags"];
    return {
      tone,
      word: level,
      headline: worst.length ? `Safety score ${safety.score}/100. Biggest risks: ${worst.join("; ")}` : `Safety score ${safety.score}/100, no red flags in Kixo's checks`,
      source:
        ageSecs != null && ageSecs < 180
          ? "Kixo's safety checks. Kixo AI adds its own score once the coin has 2 minutes of trades"
          : "Kixo's safety checks. Kixo AI scores coins in their first 2 minutes; this one is older",
      call,
    };
  }
  return null;
}

function Outlook({ risk, safety, num }: { risk: AiRisk | null; safety: Safety | null | undefined; num?: Numbers }) {
  const o = outlook(risk, safety, num?.ageSecs ?? null);
  if (!o) return null;
  const p = plan(o.tone, risk, safety, num);
  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-bg/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex h-7 items-center rounded-full border px-3 text-sm font-medium ${TONE[o.tone]}`}>{o.word}</span>
          <span className="text-xs text-muted">Next hour</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-text">{o.headline}</p>
        <p className="mt-1 text-xs text-muted">{o.source}</p>
      </div>
      <div className={`rounded-lg border px-4 py-3 ${TONE[p.tone]}`}>
        <p className="text-xs text-muted">What to do</p>
        <p className="mt-1 text-base font-medium">{p.title}</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-6 text-text">
          {p.steps.map((s) => (
            <li key={s} className="flex gap-2">
              <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-60" aria-hidden="true" />
              {s}
            </li>
          ))}
        </ul>
        {p.watch.length > 0 && (
          <>
            <p className="mt-3 text-xs text-muted">Watch for</p>
            <ul className="mt-1 flex flex-col gap-1 text-[13px] leading-5 text-text-2">
              {p.watch.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** Kixo's plan for the coin in plain words, worked out in code from the same data as the
 *  outlook so it never contradicts it: buy or not, how much, where to get out, and what
 *  would change the picture. Market cap levels are the real numbers for this coin. */
function plan(tone: Tone, risk: AiRisk | null, safety: Safety | null | undefined, n?: Numbers) {
  const mc = n?.mcUsd ?? null;
  const at = (x: number) => (mc ? ` (market cap about ${usd(mc * x)})` : "");
  const young = n?.ageSecs != null && n.ageSecs < 120;
  const fewHolders = n?.holders != null && n.holders < 20;
  const falling = n?.change5m != null && n.change5m <= -30;
  const pumped = n?.change5m != null && n.change5m >= 100;
  const sellers = n?.buys1h != null && n?.sells1h != null && n.sells1h > n.buys1h * 1.5 && n.sells1h >= 10;
  const v = risk ? verdict(risk).key : null;
  const watch: string[] = [];
  if (n?.devSoldAll) watch.push("The dev already sold everything: nobody behind it is holding");
  else watch.push("Get out at once if the dev starts selling");
  if (fewHolders) watch.push("Holders climbing past 20 is the first sign real buyers are coming");
  if (sellers) watch.push(`More sellers than buyers in the last hour (${n?.sells1h} sells, ${n?.buys1h} buys)`);

  const avoid = tone === "bad" || v === "danger" || n?.devSoldAll;
  if (avoid) {
    return {
      tone: "bad" as Tone,
      title: "Avoid. Don't buy this one",
      steps: [
        v === "danger"
          ? `Kixo AI gives it a ${pct(risk!.dump)} chance of crashing 70% or more within the hour`
          : `Safety score ${safety?.score ?? "low"}/100: too many red flags`,
        "If you already hold it, sell into the next green candle instead of hoping",
        "There are new coins every minute. Skipping this one costs you nothing",
      ],
      watch,
    };
  }
  if (young || fewHolders) {
    return {
      tone: "warn" as Tone,
      title: "Wait. Too early to tell",
      steps: [
        young ? "It is under 2 minutes old: most of the risk shows in the first minutes" : `Only ${n?.holders} holders so far: a few wallets can move the price anywhere`,
        "Come back when it has 20+ holders and the dev still holds",
        "If you buy anyway, use a small test amount you are fine losing",
      ],
      watch,
    };
  }
  if (falling) {
    return {
      tone: "warn" as Tone,
      title: "Wait. It is dropping fast",
      steps: [
        `Down ${Math.abs(n!.change5m!).toFixed(0)}% in 5 minutes. Don't catch a falling knife`,
        "Wait for 2 or 3 candles that stop going lower before you think about buying",
      ],
      watch,
    };
  }
  if (pumped) {
    return {
      tone: "warn" as Tone,
      title: "Don't chase. It already pumped",
      steps: [
        `Up ${n!.change5m!.toFixed(0)}% in 5 minutes. Buying now often means buying the top`,
        "Wait for a pullback of 20 to 30% that holds, then a small buy",
        `If you already hold it, take some profit now`,
      ],
      watch,
    };
  }
  if (tone === "good") {
    return {
      tone: "good" as Tone,
      title: "OK for a small buy, with a plan",
      steps: [
        "Use a small size: 1 to 3% of your balance",
        `Stop loss at -25%${at(0.75)}`,
        `Sell half at 2x${at(2)}, then let the rest run with a 20% trailing stop`,
      ],
      watch,
    };
  }
  if (tone === "warn") {
    return {
      tone: "warn" as Tone,
      title: "Only a small test buy, or skip",
      steps: ["Real crash risk. Keep it to 1% of your balance", `Tight stop loss at -20%${at(0.8)}`, `Take profit early, around +50%${at(1.5)}`],
      watch,
    };
  }
  return {
    tone: "muted" as Tone,
    title: "Nothing special. Skip unless you have a reason",
    steps: ["No strong signal either way from Kixo AI", `If you trade it, stop loss at -20%${at(0.8)} and keep it small`],
    watch,
  };
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
    `Use only these facts and the LIVE DATA (holders, dev position, bundlers, snipers, the dev's wallet and history). Do not repeat the address. Talk like a sharp trader friend: casual, plain English, short. Write chances as whole percentages only (like 17%), never as decimals.`,
    `Answer in plain text, one item per line, every line starting with its label:`,
    `Quick take: 1 or 2 casual sentences on what is going on with this coin.`,
    `Good: one strength per line, up to 3 lines, each with the real number.`,
    `Bad: one risk per line, up to 3 lines, each with the real number (dev selling, bundlers or snipers holding, top 10 share, dev's past rugs).`,
    `Rules for you, never repeat them: top 10 holders under 20% is healthy (Good), over 30% is a risk (Bad). Liquidity under $10K is thin (Bad), over $50K is decent (Good). Bundles or snipers still holding over 10% is a risk. Kixo's safety score: 75 or more is good, under 50 is a risk (a low score is never a strength). A fact goes in Good or in Bad, never both, and never contradict yourself. The live facts above come first: if LIVE DATA disagrees or is missing, trust the live facts. Never list missing or unknown data as a strength or a risk; just leave it out. With fewer than 10 holders, holder shares (top 10, dev, early buyers) mean nothing yet: never list them as Good.`,
    `Do not write a prediction or a call: Kixo adds those itself.`,
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


  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16 font-sans"
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
          {/* Kixo's outlook and call, from the AI model or the safety checks */}
          <Outlook risk={risk} safety={input.safety} num={input.num} />

          {/* The written read */}
          {read === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-text-2">
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
              Kixo AI is reading this coin&apos;s live data
            </p>
          ) : read ? (
            <Read lines={read} holders={input.num?.holders ?? null} />
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

type Part = "take" | "good" | "bad" | "prediction" | "call";
const LABEL: [RegExp, Part][] = [
  [/^quick take$/i, "take"],
  [/^(good|strengths?)$/i, "good"],
  [/^(bad|risks?)$/i, "bad"],
  [/^(prediction|next hour|watch)$/i, "prediction"],
  [/^(call|recommendation)$/i, "call"],
];

/** The model's read, line by line ("Good: …"), sorted into its parts. Lines without a
 *  known label belong to the part above them (the quick take at the start). */
export function parseRead(lines: string[]) {
  const out: Record<Part, string[]> = { take: [], good: [], bad: [], prediction: [], call: [] };
  let part: Part = "take";
  for (const raw of lines) {
    const l = raw.replace(/^[-•*]\s*/, "");
    const m = l.match(/^([A-Za-z ]{2,20}):\s*(.*)$/);
    const hit = m ? LABEL.find(([re]) => re.test(m[1].trim())) : undefined;
    if (hit && m) {
      part = hit[1];
      if (m[2].trim()) out[part].push(m[2].trim());
    } else if (m) {
      // A label we did not ask for (the model echoing instructions): left out.
      continue;
    } else if (l.trim()) {
      out[part].push(l.trim());
    }
  }
  // Missing data is neither a strength nor a risk.
  const unknown = /unknown|can'?t verify|no (info|data)|not available/i;
  out.good = out.good.filter((x) => !unknown.test(x));
  out.bad = out.bad.filter((x) => !unknown.test(x));
  return out;
}

/** The model's written read: the quick take, the good and the bad. The outlook and the call
 *  come from Kixo itself (Outlook), so anything the model adds there is left out. */
function Read({ lines, holders }: { lines: string[]; holders: number | null }) {
  const r = parseRead(lines);
  // With a handful of holders, holder shares say nothing: never shown as a strength.
  if (holders != null && holders < 10) r.good = r.good.filter((x) => !/top.?10|dev (holds|wallet)|of (the )?supply|holder/i.test(x));
  return (
    <div className="flex flex-col gap-4 text-sm leading-6">
      {r.take.length > 0 && <p className="text-text">{r.take.join(" ")}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Points title="Good" icon={Check} tone="text-positive" items={r.good} />
        <Points title="Bad" icon={X} tone="text-negative" items={r.bad} />
      </div>
    </div>
  );
}

function Points({ title, icon: Icon, tone, items }: { title: string; icon: typeof Check; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className={`text-xs ${tone}`}>{title}</h3>
      <ul className="mt-1.5 flex flex-col gap-1.5 text-text-2">
        {items.map((x) => (
          <li key={x} className="flex gap-2">
            <Icon size={14} strokeWidth={1.5} className={`mt-1 shrink-0 ${tone}`} />
            <span>{x}</span>
          </li>
        ))}
      </ul>
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
