"use client";
/* Tested strategies: strategies from YouTube, GitHub and X, turned into sniper rules and
   tested on Kixo's real launches every day. Results first, good or bad; "Use" loads the
   rules into the Sniper (it stays on whatever account the Sniper uses, demo first). */
import { useEffect, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { useFeatures } from "@/lib/features";
import { useSniper, type SniperSettings } from "@/lib/sniper";
import { pushToast } from "@/lib/toast";

type S = { id: number; title: string; summary: string; source_url: string; source_kind: string; rule: Partial<SniperSettings>; unsupported: string[]; days: number; trades: number; avg_pct: number; win_rate: number };

const KIND: Record<string, string> = { youtube: "YouTube", github: "GitHub", x: "X", other: "Web" };

export function StrategyLibrary() {
  const f = useFeatures();
  const sn = useSniper();
  const [list, setList] = useState<S[] | null>(null);
  useEffect(() => {
    if (!f.strategy_library) return;
    fetch(`${GATEWAY_HTTP}/strategies`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { strategies: [] }))
      .then((v) => setList(v.strategies ?? []))
      .catch(() => setList([]));
  }, [f.strategy_library]);
  if (!f.strategy_library || !list || list.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface">
      <header className="border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-text">
          <BookOpen size={14} strokeWidth={1.5} className="text-muted" />
          Tested strategies
        </p>
        <p className="mt-0.5 text-xs text-muted">Strategies from YouTube, GitHub and X, turned into rules and tested on real launches every day. Results after costs, best first</p>
      </header>
      <ul className="divide-y divide-border">
        {list.map((s) => {
          const up = s.avg_pct >= 0;
          return (
            <li key={s.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm text-text">{s.title}</span>
                {s.source_url ? (
                  <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-muted hover:text-text">
                    {KIND[s.source_kind] ?? "Web"} <ExternalLink size={10} strokeWidth={1.5} />
                  </a>
                ) : null}
                <span className={`ml-auto font-mono text-xs ${up ? "text-positive" : "text-negative"}`}>
                  {up ? "+" : ""}
                  {s.avg_pct}% a trade
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-text-2">{s.summary}</p>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {s.trades} trades · {s.win_rate}% won · tested {s.days} day{s.days === 1 ? "" : "s"}
                {s.unsupported.length > 0 ? ` · not in the rules: ${s.unsupported.slice(0, 2).join("; ")}` : ""}
              </p>
              <button
                type="button"
                onClick={() => {
                  sn.update({ ...s.rule });
                  pushToast({ tone: "info", title: `Rules loaded: ${s.title}`, body: "Check them under Rules, then turn the Sniper on. Try it on demo first" });
                }}
                className="mt-2 h-8 rounded-lg border border-border px-3 text-xs text-text hover:bg-surface-2"
              >
                Use these rules
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
