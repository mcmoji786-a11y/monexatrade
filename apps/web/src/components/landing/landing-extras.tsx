"use client";
/* Landing: the numbers band (counts up once when it scrolls into view) and the
   "Kixo AI auto trade, coming soon" section. Numbers come from the gateway where they
   can; the fee and the demo balance are product facts. */
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { TradeNowButton } from "@/components/account/auth-gate";
import { buttonClass } from "@/components/ui/button";
import { Reveal } from "./reveal";

type Overview = { model?: { coins?: number } | null; track?: { high_dump?: { coins: number; dumped: number } } | null };

function useOverview() {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/ai/overview`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setO)
      .catch(() => setO(null));
  }, []);
  return o;
}

/** A number that counts up from 0 the first time it is seen. */
function CountUp({ to, format }: { to: number; format: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setV(to);
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 1200);
        setV(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return <span ref={ref}>{format(v)}</span>;
}

export function NumbersBand() {
  const o = useOverview();
  const trained = o?.model?.coins ?? 487_368;
  const danger = o?.track?.high_dump && o.track.high_dump.coins >= 20 ? o.track.high_dump.dumped : null;
  const items = [
    { k: "Launches Kixo AI trained on", to: trained, f: (v: number) => Math.round(v).toLocaleString("en-US") },
    ...(danger != null ? [{ k: "Danger calls that crashed, last 24 hours", to: danger * 100, f: (v: number) => `${Math.round(v)}%` }] : []),
    { k: "Fee per trade. Most terminals charge about 1%", to: 0.5, f: (v: number) => `${v.toFixed(1)}%` },
    { k: "Demo money to start, at live prices", to: 10_000, f: (v: number) => `$${Math.round(v).toLocaleString("en-US")}` },
  ];
  return (
    <section className="mx-auto max-w-300 px-4 py-20 md:px-8">
      <dl className={`grid grid-cols-2 gap-x-6 gap-y-10 ${items.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {items.map((it) => (
          <div key={it.k} className="border-t border-border pt-5">
            <dd className="font-mono text-3xl tabular-nums text-text md:text-4xl">
              <CountUp to={it.to} format={it.f} />
            </dd>
            <dt className="mt-2 text-sm text-text-2">{it.k}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

const ROADMAP = [
  { done: true, title: "Reads every launch", body: "The first 2 minutes of every new Solana coin, and who bought it" },
  { done: true, title: "Calls Danger", body: "Live on Sol Radar, the trade page and the AI page" },
  { done: true, title: "Gets you out", body: "Rug exit sells your demo position when the dev sells or the AI says Danger" },
  { done: false, title: "Trades for you", body: "Kixo AI auto trade buys and sells on its own, under your limits" },
];

export function AutoTradeSoon() {
  const o = useOverview();
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-300 gap-12 px-4 py-24 md:px-8 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <p className="font-mono text-xs text-cyan">Coming soon</p>
          <h2 className="mt-3 text-3xl font-medium leading-tight text-text md:text-4xl">Kixo AI auto trade is in training</h2>
          <p className="mt-4 text-base leading-7 text-text-2">
            We are training Kixo AI on every new Solana launch, every night. Before it trades for you, it has to prove it makes money after fees on coins it has never seen. It launches soon. Until then, practise with Kixo AI&apos;s calls on the demo account.
          </p>
          <div className="mt-8">
            <TradeNowButton className={buttonClass("primary", "lg")}>Start on demo today</TradeNowButton>
          </div>
        </Reveal>

        <Reveal delay={100}>
          <div className="overflow-hidden rounded-2xl border border-border bg-bg">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-sm text-text">Kixo AI</span>
              <span className="font-mono text-xs text-muted">{o?.model?.coins ? `${o.model.coins.toLocaleString("en-US")} launches · retrained nightly` : "retrained nightly"}</span>
            </div>
            <ol className="flex flex-col">
              {ROADMAP.map((r, i) => (
                <li key={r.title} className="flex gap-4 border-b border-border px-5 py-4 last:border-0">
                  <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border ${r.done ? "border-positive/40 text-positive" : "border-cyan/40 text-cyan"}`}>
                    {r.done ? <Check size={14} strokeWidth={1.5} /> : <span className="font-mono text-xs">{i + 1}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-text">
                      {r.title}
                      {!r.done && <span className="font-mono text-xs text-cyan">Launching soon</span>}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-text-2">{r.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
