"use client";
/* The creator's track record, in plain words, at the top of the trade page: how many
   coins this wallet launched before (as Kixo's engine saw them), how many rugged, died
   within minutes or graduated. A creator who rugged before is the clearest warning a
   new coin can carry, so it is never hidden in a score. */
import { History, ShieldAlert, ShieldCheck } from "lucide-react";
import type { DevReport } from "@/lib/gateway";
import { usd } from "@/lib/gateway";
import { WalletLink } from "@/components/tracker/wallet-tracker";
import { useFeatures } from "@/lib/features";

export function DevRecord({ report: d, creator }: { report: DevReport | null | undefined; creator: string }) {
  const f = useFeatures();
  if (!d || !f.dev_record) return null;
  const bad = d.rugged > 0;
  const weak = !bad && d.coins >= 3 && d.died_fast >= d.coins * 0.8;
  const good = !bad && !weak && d.graduated > 0;
  const tone = bad ? "border-negative/30 bg-negative/5" : weak ? "border-warning/30 bg-warning/5" : good ? "border-positive/25 bg-positive/5" : "border-border bg-surface";
  const Icon = bad || weak ? ShieldAlert : good ? ShieldCheck : History;
  const iconTone = bad ? "text-negative" : weak ? "text-warning" : good ? "text-positive" : "text-muted";

  const headline =
    d.coins === 0
      ? "First coin Kixo has seen from this creator"
      : bad
        ? `This creator rugged ${d.rugged} of ${d.coins} earlier coin${d.coins === 1 ? "" : "s"}`
        : weak
          ? `${d.died_fast} of this creator's ${d.coins} earlier coins died within minutes`
          : good
            ? `This creator graduated ${d.graduated} of ${d.coins} earlier coin${d.coins === 1 ? "" : "s"}`
            : `This creator launched ${d.coins} earlier coin${d.coins === 1 ? "" : "s"}`;

  return (
    <section data-tour="trade-dev" className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 ${tone}`} aria-label="Creator record">
      <p className="flex min-w-0 items-center gap-2 text-sm text-text">
        <Icon size={15} strokeWidth={1.5} className={`shrink-0 ${iconTone}`} />
        <span className="min-w-0">{headline}</span>
      </p>
      {d.coins > 0 && (
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-text-2">
          <Fig k="Launched" v={d.coins} />
          <Fig k="Rugged" v={d.rugged} tone={d.rugged > 0 ? "text-negative" : undefined} />
          <Fig k="Died fast" v={d.died_fast} />
          <Fig k="Graduated" v={d.graduated} tone={d.graduated > 0 ? "text-positive" : undefined} />
          {d.best_peak_mc_usd != null && <Fig k="Best peak" v={usd(d.best_peak_mc_usd)} />}
        </dl>
      )}
      <span className="ml-auto text-xs text-muted">
        Creator <WalletLink address={creator} extra={["dev"]} badges={false} className="text-text-2 hover:text-text" />
      </span>
    </section>
  );
}

function Fig({ k, v, tone }: { k: string; v: number | string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <dt className="font-sans text-muted">{k}</dt>
      <dd className={tone ?? "text-text"}>{v}</dd>
    </span>
  );
}
