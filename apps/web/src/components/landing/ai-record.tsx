"use client";
/* Landing: Kixo AI's real record over the last 24 hours (gateway /ai/overview "track"):
   of the coins it called Danger, how many crashed within the hour, against all coins.
   Without enough live coins it shows the model's test result, and says so. */
import { useEffect, useState } from "react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { Reveal } from "./reveal";

type Bucket = { coins: number; dumped: number; doubled: number };
type Overview = {
  track?: { all?: Bucket; high_dump?: Bucket; low_dump?: Bucket; window_h?: number } | null;
  model?: { coins?: number; targets?: { dump?: { base_rate: number; top10pct_rate: number; auc: number } } } | null;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => x.toLocaleString("en-US");

export function AiRecord() {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/ai/overview`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setO)
      .catch(() => setO(null));
  }, []);

  const t = o?.track;
  const live = t?.high_dump && t.all && t.high_dump.coins >= 20 ? { danger: t.high_dump, all: t.all, safe: t.low_dump, hours: t.window_h ?? 24 } : null;
  const test = o?.model?.targets?.dump;
  const danger = live ? live.danger.dumped : test?.top10pct_rate;
  const base = live ? live.all.dumped : test?.base_rate;
  if (danger == null || base == null) return null;

  const rows = [
    { k: "Coins Kixo AI called Danger", v: danger, n: live?.danger.coins, accent: true },
    { k: "All new coins", v: base, n: live?.all.coins },
    ...(live?.safe ? [{ k: "Coins with a low crash chance", v: live.safe.dumped, n: live.safe.coins }] : []),
  ];

  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto grid max-w-300 gap-12 px-4 py-24 md:px-8 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <p className="font-mono text-xs text-emerald">The record</p>
          <h2 className="mt-3 text-3xl font-medium leading-tight text-text md:text-4xl">When Kixo AI says Danger, it usually is</h2>
          <p className="mt-4 text-base leading-7 text-text-2">
            {live
              ? `Measured on real launches over the last ${live.hours} hours: how many coins crashed 70% or more within an hour of the AI's word.`
              : "From the model's last test on coins it had never seen: how many crashed 70% or more within the hour."}
          </p>
          <p className="mt-6 font-mono text-xs text-muted">
            {o?.model?.coins ? `Trained on ${n(o.model.coins)} launches` : ""}
            {test?.auc ? ` · test AUC ${test.auc.toFixed(3)}` : ""}
          </p>
        </Reveal>

        <Reveal delay={100}>
          <div className="rounded-2xl border border-border bg-bg p-6 md:p-8">
            <p className="text-sm text-text-2">Crashed within the hour</p>
            <p className="mt-2 font-mono text-6xl tabular-nums text-negative">{pct(danger)}</p>
            <p className="mt-1 text-sm text-text-2">of the coins it called Danger, against {pct(base)} of all new coins</p>
            <ul className="mt-8 flex flex-col gap-4">
              {rows.map((r) => (
                <li key={r.k}>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-text-2">{r.k}</span>
                    <span className="font-mono tabular-nums text-text">
                      {pct(r.v)}
                      {r.n ? <span className="ml-2 text-xs text-muted">of {n(r.n)}</span> : null}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className={`grow-x h-full rounded-full ${r.accent ? "bg-negative" : "bg-text-2/50"}`} style={{ width: `${Math.max(1, r.v * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-muted">The AI is best at telling you what not to buy. It is not a promise any coin goes up</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
