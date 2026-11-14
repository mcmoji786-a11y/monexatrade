"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { adminFetch } from "@/lib/admin";

type Sample = { t: number; database: boolean; rpc: boolean; stream: boolean };
type Incident = { part: "database" | "rpc" | "stream"; from: number; to: number | null };
type Group = { source: "gateway" | "browser"; level: "error" | "warn"; target: string; message: string; count: number; first: number; last: number };
type RpcNode = { name: string; served: number; skipped: string | null };
type SystemReply = {
  now: number;
  started: number;
  uptime: { all: number | null; database: number | null; rpc: number | null; stream: number | null };
  samples: Sample[];
  incidents: Incident[];
  rpc: { active: string; nodes: RpcNode[] };
  /** Kixo AI risk (gateway ai_risk.rs); missing on an older gateway. */
  ai?: { service: boolean; scored: number; waiting: number };
  errors: Group[];
};

const PART: Record<Incident["part"], string> = { database: "Database", rpc: "Solana RPC", stream: "Live stream" };

function ago(secs: number) {
  const s = Math.max(0, secs);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function span(secs: number) {
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}
const clock = (t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Admin: is Kixo up, what went down in the last day, and every warning and error,
 *  grouped. Kept in the gateway's memory since it started. */
export function SystemAdmin() {
  const [data, setData] = useState<SystemReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "error" | "warn" | "browser">("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      adminFetch<SystemReply>("/admin/system")
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);

  // The last 24 hours in 96 bars of 15 minutes: green when every part was up.
  const bars = useMemo(() => {
    if (!data) return [];
    const end = data.now;
    return Array.from({ length: 96 }, (_, i) => {
      const from = end - (96 - i) * 900;
      const inBar = data.samples.filter((s) => s.t > from && s.t <= from + 900);
      if (!inBar.length) return { from, state: "none" as const, down: [] as string[] };
      const down = (["database", "rpc", "stream"] as const).filter((p) => inBar.some((s) => !s[p])).map((p) => PART[p]);
      return { from, state: down.length ? ("down" as const) : ("up" as const), down };
    });
  }, [data]);

  if (!data)
    return <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-text-2">{error ?? <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-muted" />}</p>;

  const last = data.samples[data.samples.length - 1];
  const downNow = last ? (["database", "rpc", "stream"] as const).filter((p) => !last[p]) : [];
  const shown = data.errors.filter((g) => (filter === "all" ? true : filter === "browser" ? g.source === "browser" : g.level === filter && g.source === "gateway"));
  const counts = { error: data.errors.filter((g) => g.level === "error" && g.source === "gateway").length, warn: data.errors.filter((g) => g.level === "warn").length, browser: data.errors.filter((g) => g.source === "browser").length };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface px-5 py-4">
        <div className="flex items-center gap-3">
          <span className={`size-2.5 rounded-full ${!last ? "bg-muted" : downNow.length ? "bg-negative" : "bg-positive"}`} />
          <div>
            <p className="text-base text-text">{!last ? "First check runs within a minute" : downNow.length ? `${downNow.map((p) => PART[p]).join(", ")} down` : "All systems up"}</p>
            <p className="text-xs text-muted">
              Gateway running {span(data.now - data.started)} · checked every minute{last ? `, last ${ago(data.now - last.t)}` : ""}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setTick((n) => n + 1)} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text">
          <RefreshCw size={13} strokeWidth={1.5} /> Refresh
        </button>
      </section>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {(
          [
            ["Everything", data.uptime.all],
            ["Database", data.uptime.database],
            ["Solana RPC", data.uptime.rpc],
            ["Live stream", data.uptime.stream],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <p className="text-xs text-muted">{k}, last 24h</p>
            <p className={`mt-1 font-mono text-xl tabular-nums ${v == null ? "text-text-2" : v >= 99.5 ? "text-positive" : v >= 95 ? "text-warning" : "text-negative"}`}>{v == null ? "—" : `${v}%`}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-border bg-surface px-5 py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text">Last 24 hours</h2>
          <span className="font-mono text-xs text-muted">15 minutes per bar</span>
        </div>
        <div className="mt-3 flex h-8 items-end gap-[2px]">
          {bars.map((b) => (
            <span
              key={b.from}
              title={`${clock(b.from)}: ${b.state === "none" ? "no data" : b.state === "up" ? "all up" : `${b.down.join(", ")} down`}`}
              className={`h-full flex-1 rounded-[2px] ${b.state === "up" ? "bg-positive/70" : b.state === "down" ? "bg-negative" : "bg-surface-3"}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
          <span>24h ago</span>
          <span>now</span>
        </div>
        {data.incidents.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3 text-xs">
            {data.incidents.slice(0, 12).map((i) => (
              <li key={`${i.part}-${i.from}`} className="flex flex-wrap gap-x-3 text-text-2">
                <span className="w-24 text-text">{PART[i.part]}</span>
                <span className="font-mono">{clock(i.from)}</span>
                <span className={i.to == null ? "text-negative" : "text-muted"}>{i.to == null ? "still down" : `down ${span(i.to - i.from)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface px-5 py-4">
        <h2 className="text-sm font-medium text-text">Solana RPC</h2>
        <ul className="mt-3 flex flex-col gap-1.5 text-xs">
          {data.rpc.nodes.map((n) => (
            <li key={n.name} className="flex flex-wrap items-center gap-x-3 text-text-2">
              <span className={`size-1.5 rounded-full ${n.name === data.rpc.active ? "bg-positive" : n.skipped ? "bg-warning" : "bg-muted"}`} />
              <span className="w-28 font-mono text-text">{n.name}</span>
              <span className="font-mono">{n.served.toLocaleString()} served</span>
              {n.skipped && <span className="text-warning">skipped: {n.skipped}</span>}
              {n.name === data.rpc.active && <span className="text-positive">in use</span>}
            </li>
          ))}
        </ul>
      </section>

      {data.ai && (
        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <h2 className="text-sm font-medium text-text">Kixo AI</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
            <span className={`size-1.5 rounded-full ${data.ai.service ? "bg-positive" : "bg-warning"}`} />
            <span className="text-text">{data.ai.service ? "Service answering" : "Service not answering yet"}</span>
            <span className="font-mono">{data.ai.scored.toLocaleString()} coins scored</span>
            <span className="font-mono">{data.ai.waiting.toLocaleString()} in their first 2 minutes</span>
          </div>
          {!data.ai.service && <p className="mt-2 text-xs text-muted">Start it with scripts\kixo-start.cmd (ai/serve.py on port 8090). It reads only after the first coin is ready</p>}
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-text">
            Errors and warnings <span className="ml-1 font-mono text-xs text-muted">{data.errors.length} kinds</span>
          </h2>
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["error", `Errors ${counts.error}`],
                ["warn", `Warnings ${counts.warn}`],
                ["browser", `Browsers ${counts.browser}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`h-7 rounded-md px-2.5 text-xs ${filter === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-2">Nothing here since the gateway started</p>
        ) : (
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="h-9 border-b border-border text-left text-muted">
                  <th className="pl-4 font-normal">Level</th>
                  <th className="font-normal">Where</th>
                  <th className="font-normal">Message</th>
                  <th className="px-3 text-right font-normal">Times</th>
                  <th className="pr-4 text-right font-normal">Last</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={`${g.source}${g.level}${g.target}${g.message}`} className="border-b border-border align-top last:border-0">
                    <td className="py-2.5 pl-4">
                      <span className={g.level === "error" ? "text-negative" : "text-warning"}>{g.level === "error" ? "Error" : "Warning"}</span>
                      {g.source === "browser" && <span className="ml-1.5 text-muted">browser</span>}
                    </td>
                    <td className="max-w-48 truncate py-2.5 pr-3 font-mono text-text-2" title={g.target}>
                      {g.target}
                    </td>
                    <td className="py-2.5 pr-3 font-mono break-all text-text">{g.message}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-text-2">{g.count.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right font-mono whitespace-nowrap text-muted" title={`first ${clock(g.first)}`}>
                      {ago(data.now - g.last)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-muted">Kept in the gateway&apos;s memory and cleared when it restarts. Point an outside uptime check at /health as well, so a crash is noticed too</p>
    </div>
  );
}
