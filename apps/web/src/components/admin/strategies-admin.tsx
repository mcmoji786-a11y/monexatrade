"use client";
/* Admin, Strategies: paste a strategy (YouTube transcript, GitHub README, X thread) or let
   Kixo look on GitHub; a language model turns it into sniper rules, they are tested on
   the last 24 hours of real launches at once and daily after. Publish only what you have
   read: users always see the results next to it. */
import { useCallback, useEffect, useState } from "react";
import { FlaskConical, FolderGit2, Loader2, Trash2 } from "lucide-react";
import { adminFetch } from "@/lib/admin";
import { pushToast } from "@/lib/toast";

type Test = { at: number; trades: number; win_rate: number; avg_pct: number; total_usd: number };
type S = { id: number; title: string; summary: string; source_url: string; source_kind: string; rule: Record<string, unknown>; unsupported: string[]; published: boolean; last: Test | null; days: number; trades: number; avg_pct: number; win_rate: number };

export function StrategiesAdmin() {
  const [list, setList] = useState<S[] | null>(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<{ strategies: S[] }>("/admin/strategies")
      .then((r) => setList(r.strategies))
      .catch((e) => pushToast({ tone: "bad", title: "Could not load", body: e instanceof Error ? e.message : "" }));
  }, []);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) pushToast({ tone: "good", title: done });
      load();
    } catch (e) {
      pushToast({ tone: "bad", title: "Not done", body: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium text-text">Strategies</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-2">Strategies from outside, turned into sniper rules and tested on Kixo&apos;s real launches every day. Users only see what you publish, always with its results</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm text-text">Add from a source</p>
          <p className="mt-0.5 text-xs text-muted">The link, and the text: a YouTube transcript (on YouTube: More, Show transcript, copy), a README, or an X thread</p>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/… or https://github.com/…" className="mt-3 h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-emerald/50" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Paste the transcript or text" className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-emerald/50" />
          <button
            type="button"
            disabled={!!busy || text.trim().length < 80}
            onClick={() => run("extract", async () => {
              await adminFetch("/admin/strategies/extract", { method: "POST", body: { source_url: url, text } });
              setText("");
              setUrl("");
            }, "Turned into rules and tested")}
            className="mt-3 flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-50"
          >
            {busy === "extract" && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            Turn into rules and test
          </button>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="flex items-center gap-2 text-sm text-text">
            <FolderGit2 size={14} strokeWidth={1.5} className="text-muted" />
            Look on GitHub
          </p>
          <p className="mt-0.5 text-xs text-muted">Reads up to five new repos&apos; READMEs and makes tested drafts for you to review</p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="pump.fun sniper strategy" className="mt-3 h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-emerald/50" />
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run("github", async () => {
              const r = await adminFetch<{ made: unknown[]; skipped: unknown[] }>("/admin/strategies/github", { method: "POST", body: { query: q } });
              pushToast({ tone: "info", title: `${r.made.length} drafts made`, body: `${r.skipped.length} repos had no usable rules` });
            })}
            className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
          >
            {busy === "github" && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            Search GitHub
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <p className="border-b border-border px-4 py-3 text-sm text-text">{list ? `${list.length} strategies` : "Loading"}</p>
        <ul className="divide-y divide-border">
          {(list ?? []).map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-text">{s.title}</span>
                <span className="rounded border border-border px-1.5 text-[10px] text-muted">{s.source_kind}</span>
                {s.published && <span className="rounded border border-emerald/40 px-1.5 text-[10px] text-emerald">published</span>}
                <span className={`ml-auto font-mono text-xs ${s.avg_pct >= 0 ? "text-positive" : "text-negative"}`}>{s.last ? `${s.avg_pct >= 0 ? "+" : ""}${s.avg_pct}% avg · ${s.trades} trades · ${s.win_rate}% won · ${s.days} day${s.days === 1 ? "" : "s"}` : "not tested"}</span>
              </div>
              <p className="mt-1 text-xs text-text-2">{s.summary}</p>
              {s.unsupported.length > 0 && <p className="mt-1 text-[11px] text-muted">Not in the rules: {s.unsupported.join("; ")}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {s.source_url && (
                  <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-text-2 underline underline-offset-2 hover:text-text">
                    Source
                  </a>
                )}
                <button type="button" disabled={!!busy} onClick={() => run(`t${s.id}`, () => adminFetch(`/admin/strategies/${s.id}/test`, { method: "POST" }), "Tested again")} className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-text-2 hover:text-text">
                  <FlaskConical size={12} strokeWidth={1.5} /> Test again
                </button>
                <button type="button" disabled={!!busy || !s.last} onClick={() => run(`p${s.id}`, () => adminFetch(`/admin/strategies/${s.id}`, { method: "PUT", body: { published: !s.published } }))} className="h-7 rounded-md border border-border px-2 text-text-2 hover:text-text disabled:opacity-40">
                  {s.published ? "Unpublish" : "Publish"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => confirm(`Delete "${s.title}"?`) && run(`d${s.id}`, () => adminFetch(`/admin/strategies/${s.id}`, { method: "DELETE" }))} aria-label="Delete" className="ml-auto text-muted hover:text-negative">
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
