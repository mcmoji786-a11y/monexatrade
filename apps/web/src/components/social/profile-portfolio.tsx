"use client";
/* A trader's portfolio on their profile: open demo positions at what selling now would
   bring, their best and worst sales, and every trade. Hidden amounts show percentages. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getPortfolio, money, type Portfolio, type ProfilePosition, type SocialTrade } from "@/lib/social";
import { tokenHref } from "@/lib/open-token";
import { TokenLogo } from "@/components/token/token-bits";
import { TradeLine } from "./social-bits";

function usePortfolio(handle: string) {
  const [p, setP] = useState<{ handle: string; data: Portfolio | null; err: string | null }>({ handle: "", data: null, err: null });
  useEffect(() => {
    let alive = true;
    const load = () =>
      getPortfolio(handle)
        .then((data) => alive && setP({ handle, data, err: null }))
        .catch((e) => alive && setP((cur) => ({ handle, data: cur.handle === handle ? cur.data : null, err: e instanceof Error ? e.message : "Could not load" })));
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [handle]);
  return p.handle === handle ? p : { handle, data: null, err: null };
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const tone = (v: number | null | undefined) => (v == null ? "text-muted" : v >= 0 ? "text-positive" : "text-negative");
const held = (iso: string, now: number) => {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

export function ProfilePositions({ handle }: { handle: string }) {
  const { data, err } = usePortfolio(handle);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  if (err && !data) return <p className="px-5 py-10 text-center text-sm text-muted">{err}</p>;
  if (!data) return <p className="px-5 py-10 text-center text-sm text-muted">Loading</p>;
  const pos = data.positions;
  const open = pos.reduce((a, p) => a + (p.value_usd ?? 0), 0);
  const cost = pos.reduce((a, p) => a + (p.cost_usd ?? 0), 0);
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-sm font-medium text-text">
          Open positions <span className="font-mono text-xs text-muted">{pos.length}</span>
        </h2>
        {!data.hidden_amounts && pos.length > 0 && (
          <p className="font-mono text-xs text-muted">
            Worth {money(open)} · <span className={tone(open - cost)}>{`${open - cost >= 0 ? "+" : ""}${money(open - cost)}`}</span> open profit
          </p>
        )}
      </div>
      {pos.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No open positions right now</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="h-9 border-b border-border text-left text-xs text-muted">
                <th className="pl-5 font-normal">Coin</th>
                {!data.hidden_amounts && <th className="px-3 text-right font-normal">Cost</th>}
                {!data.hidden_amounts && <th className="px-3 text-right font-normal">Worth now</th>}
                <th className="px-3 text-right font-normal">Profit</th>
                <th className="pr-5 text-right font-normal">Held</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <PositionRow key={p.mint} p={p} hidden={data.hidden_amounts} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border px-5 py-2.5 text-[11px] text-muted">Demo account. Worth now is what selling would bring at the live price, after fees and price impact</p>
    </section>
  );
}

function PositionRow({ p, hidden, now }: { p: ProfilePosition; hidden: boolean; now: number }) {
  return (
    <tr className="h-12 border-b border-border last:border-0 hover:bg-surface-2">
      <td className="pl-5">
        <Link href={tokenHref(p.mint)} className="flex items-center gap-2.5 text-text hover:underline">
          <TokenLogo src={p.image} symbol={p.symbol || "?"} size={24} />
          {p.symbol || `${p.mint.slice(0, 4)}…`}
        </Link>
      </td>
      {!hidden && <td className="px-3 text-right font-mono text-text-2">{p.cost_usd != null ? money(p.cost_usd) : "—"}</td>}
      {!hidden && <td className="px-3 text-right font-mono text-text">{p.value_usd != null ? money(p.value_usd) : "—"}</td>}
      <td className={`px-3 text-right font-mono ${tone(p.pnl_pct)}`}>
        {!hidden && p.pnl_usd != null && <span className="mr-2">{`${p.pnl_usd >= 0 ? "+" : ""}${money(p.pnl_usd)}`}</span>}
        <span className={hidden ? "" : "text-xs opacity-80"}>{pct(p.pnl_pct)}</span>
      </td>
      <td className="pr-5 text-right font-mono text-xs text-text-2">{now ? held(p.opened_at, now) : ""}</td>
    </tr>
  );
}

export function ProfileHistory({ handle }: { handle: string }) {
  const { data, err } = usePortfolio(handle);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  if (err && !data) return <p className="px-5 py-10 text-center text-sm text-muted">{err}</p>;
  if (!data) return <p className="px-5 py-10 text-center text-sm text-muted">Loading</p>;
  const list = data.history.filter((t) => side === "all" || t.side === side);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Ranked title="Best trades" list={data.best} />
        <Ranked title="Worst trades" list={data.worst} />
      </div>
      <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium text-text">
            All trades <span className="font-mono text-xs text-muted">{data.history.length}</span>
          </h2>
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Side">
            {(
              [
                ["all", "All"],
                ["buy", "Buys"],
                ["sell", "Sells"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setSide(k)} aria-pressed={side === k} className={`h-7 rounded-md px-2.5 text-xs ${side === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">No trades</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((x) => (
              <TradeLine key={x.id} t={x} now={now} showTrader={false} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Ranked({ title, list }: { title: string; list: SocialTrade[] }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3 text-sm font-medium text-text">{title}</h2>
      {list.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-muted">None yet</p>
      ) : (
        <ol className="divide-y divide-border">
          {list.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="w-4 font-mono text-xs text-muted">{i + 1}</span>
              <Link href={tokenHref(t.mint)} className="min-w-0 flex-1 truncate text-text hover:underline">
                {t.symbol || `${t.mint.slice(0, 4)}…`}
              </Link>
              {t.realized_usd != null && <span className={`font-mono ${tone(t.realized_usd)}`}>{`${t.realized_usd >= 0 ? "+" : ""}${money(t.realized_usd)}`}</span>}
              <span className={`w-16 text-right font-mono text-xs ${tone(t.realized_pct)}`}>{pct(t.realized_pct)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
