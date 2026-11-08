"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, PauseCircle, PlayCircle, Search, X } from "lucide-react";
import { adminDownload, adminFetch } from "@/lib/admin";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sol = (lamports: number | null | undefined) => (lamports == null ? "—" : `${(lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`);
const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const short = (a: string | null | undefined) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—");
const quiet = "flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40";

function ExportButton({ kind, label }: { kind: "users" | "trades" | "transfers"; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={quiet}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await adminDownload(`/admin/export/${kind}`, `kixo-${kind}-${new Date().toISOString().slice(0, 10)}.csv`);
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <Download size={14} strokeWidth={1.5} />}
        {label}
      </button>
      {error && <span className="text-xs text-negative">{error}</span>}
    </span>
  );
}

/* ---------------- Users ---------------- */

type UserRow = { id: string; email: string | null; provider: string | null; created_at: string; last_sign_in_at: string | null; wallet: string | null; two_fa: boolean; paused: string | null };
type UsersReply = { total: number; matches: number; with_wallet: number; users: UserRow[] };

export function UsersAdmin() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<UsersReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    adminFetch<UsersReply>(`/admin/users?q=${encodeURIComponent(query)}&limit=200`)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
    };
  }, [query, tick]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <Search size={14} strokeWidth={1.5} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email, Kixo wallet or user id" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        </form>
        <ExportButton kind="users" label="Export users" />
      </div>
      {data && (
        <p className="text-xs text-text-2">
          <span className="font-mono tabular-nums text-text">{data.total}</span> accounts · <span className="font-mono tabular-nums text-text">{data.with_wallet}</span> with a Kixo wallet
          {query && (
            <>
              {" "}
              · <span className="font-mono tabular-nums text-text">{data.matches}</span> match &ldquo;{query}&rdquo;
            </>
          )}
        </p>
      )}
      {error && <p className="text-sm text-negative">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-normal">Email</th>
              <th className="px-4 py-2 font-normal">Sign-in</th>
              <th className="px-4 py-2 font-normal">Joined</th>
              <th className="px-4 py-2 font-normal">Last seen</th>
              <th className="px-4 py-2 font-normal">Kixo wallet</th>
              <th className="px-4 py-2 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-text-2">Loading</td>
              </tr>
            ) : data.users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-text-2">No accounts match</td>
              </tr>
            ) : (
              data.users.map((u) => (
                <tr key={u.id} onClick={() => setOpen(u.id)} className="cursor-pointer border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2">{u.email ?? <span className="text-muted">no email</span>}</td>
                  <td className="px-4 py-2 capitalize text-text-2">{u.provider ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs tabular-nums text-text-2">{date(u.created_at)}</td>
                  <td className="px-4 py-2 font-mono text-xs tabular-nums text-text-2">{date(u.last_sign_in_at)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-cyan">{short(u.wallet)}</td>
                  <td className="px-4 py-2 text-xs">{u.paused !== null ? <span className="text-warning">Trading paused</span> : <span className="text-text-2">Active</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {open && <UserPanel id={open} onClose={() => setOpen(null)} onChanged={() => setTick((t) => t + 1)} />}
    </div>
  );
}

type Detail = {
  user: UserRow;
  paused: string | null;
  balance_lamports: number | null;
  trades: { created_at: string; side: string; symbol: string; sol_lamports: number; platform_fee_lamports: number; status: string; signature: string }[];
  tickets: { id: number; subject: string; status: string; created_at: string }[];
  demo: { equity_usd?: number; cash_usd?: number } | null;
  transfers: { ts: number; kind: string; amount: number; fee: number; status: string; sig: string }[];
};

function UserPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    adminFetch<Detail>(`/admin/users/${id}`)
      .then((v) => alive && setD(v))
      .catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
    };
  }, [id, tick]);

  async function setPaused(paused: boolean) {
    setBusy(true);
    try {
      await adminFetch(`/admin/users/${id}/pause`, { body: { paused, reason } });
      setReason("");
      setTick((t) => t + 1);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  // A portal: the admin's animated page wrapper would otherwise clip a fixed panel.
  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="h-full w-full max-w-[520px] overflow-y-auto border-l border-border bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-medium">{d?.user.email ?? "Account"}</h3>
            <p className="mt-1 font-mono text-[11px] text-muted">{id}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-negative">{error}</p>}
        {!d ? (
          <p className="mt-6 text-sm text-text-2">Loading</p>
        ) : (
          <div className="mt-6 flex flex-col gap-6 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <Stat k="Kixo wallet" v={d.user.wallet ? short(d.user.wallet) : "Not set up"} mono />
              <Stat k="Wallet balance" v={sol(d.balance_lamports)} mono />
              <Stat k="Signed in with" v={d.user.provider ?? "—"} />
              <Stat k="2FA" v={d.user.two_fa ? "On" : "Off"} />
              <Stat k="Joined" v={date(d.user.created_at)} />
              <Stat k="Demo account" v={d.demo?.equity_usd != null ? `$${Number(d.demo.equity_usd).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"} mono />
            </dl>

            <section className="rounded-lg border border-border p-4">
              <h4 className="text-sm font-medium">Trading</h4>
              {d.paused !== null ? (
                <>
                  <p className="mt-1 text-xs text-warning">Paused{d.paused ? `: ${d.paused}` : ""}. Trading and deposits are off; withdrawals still work</p>
                  <button type="button" disabled={busy} className={`${quiet} mt-3`} onClick={() => setPaused(false)}>
                    <PlayCircle size={14} strokeWidth={1.5} />
                    Resume trading
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-1 text-xs text-text-2">Pausing stops trades and deposits. The user can still withdraw their SOL</p>
                  <div className="mt-3 flex gap-2">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason the user sees" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-emerald/50" />
                    <button type="button" disabled={busy} className={quiet} onClick={() => setPaused(true)}>
                      <PauseCircle size={14} strokeWidth={1.5} />
                      Pause
                    </button>
                  </div>
                </>
              )}
            </section>

            <List title="Real trades" empty="No real trades">
              {d.trades.map((t) => (
                <Row key={t.signature} left={`${t.side} ${t.symbol || ""}`} mid={sol(t.sol_lamports)} right={`${t.status} · fee ${sol(t.platform_fee_lamports)}`} />
              ))}
            </List>
            <List title="Deposits and withdrawals" empty="None yet">
              {d.transfers.map((t) => (
                <Row key={t.sig} left={t.kind} mid={sol(t.amount)} right={`${t.status} · fee ${sol(t.fee)}`} />
              ))}
            </List>
            <List title="Support tickets" empty="No tickets">
              {d.tickets.map((t) => (
                <Row key={t.id} left={`#${t.id} ${t.subject}`} mid="" right={t.status} />
              ))}
            </List>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Stat({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className={`mt-0.5 capitalize text-text ${mono ? "font-mono normal-case tabular-nums" : ""}`}>{v}</dd>
    </div>
  );
}

function List({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section>
      <h4 className="text-sm font-medium">{title}</h4>
      {children.length === 0 ? <p className="mt-2 text-xs text-muted">{empty}</p> : <ul className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border">{children}</ul>}
    </section>
  );
}

function Row({ left, mid, right }: { left: string; mid: string; right: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate capitalize text-text">{left}</span>
      <span className="font-mono tabular-nums text-text-2">{mid}</span>
      <span className="text-muted">{right}</span>
    </li>
  );
}

/* ---------------- Earnings ---------------- */

type Bucket = { today: number; d7: number; d30: number; all: number; count: number };
type Earnings = { trades: Bucket; deposits: Bucket; withdrawals: Bucket; days: number[]; fee_wallet: string | null; fee_wallet_balance: number | null; pending_transfers: number };

export function EarningsAdmin() {
  const [e, setE] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminFetch<Earnings>("/admin/earnings")
      .then(setE)
      .catch((x) => setError(message(x)));
  }, []);
  if (error) return <p className="text-sm text-negative">{error}</p>;
  if (!e) return <p className="text-sm text-text-2">Loading</p>;
  const total = (k: keyof Bucket) => e.trades[k] + e.deposits[k] + e.withdrawals[k];
  const max = Math.max(1, ...e.days);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["Today", "today"],
            ["Last 7 days", "d7"],
            ["Last 30 days", "d30"],
            ["All time", "all"],
          ] as const
        ).map(([label, k]) => (
          <div key={k} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-text-2">{label}</p>
            <p className="mt-2 font-mono text-2xl tabular-nums">{sol(total(k))}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-sm font-medium">Fees per day, last 30 days</h3>
        <div className="mt-4 flex h-32 items-end gap-1" aria-label="Fees per day">
          {e.days.map((v, i) => (
            <div key={i} title={sol(v)} className={`flex-1 rounded-sm ${i === e.days.length - 1 ? "bg-emerald" : "bg-surface-3"}`} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
          ))}
        </div>
        <p className="mt-2 flex justify-between font-mono text-[11px] text-muted">
          <span>30 days ago</span>
          <span>Today</span>
        </p>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-normal">Source</th>
              <th className="px-4 py-2 text-right font-normal">Today</th>
              <th className="px-4 py-2 text-right font-normal">7 days</th>
              <th className="px-4 py-2 text-right font-normal">30 days</th>
              <th className="px-4 py-2 text-right font-normal">All time</th>
              <th className="px-4 py-2 text-right font-normal">Count</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs tabular-nums">
            {(
              [
                ["Trade fees", e.trades],
                ["Deposit fees", e.deposits],
                ["Withdrawal fees", e.withdrawals],
              ] as const
            ).map(([label, b]) => (
              <tr key={label} className="border-t border-border">
                <td className="px-4 py-2 font-sans text-sm">{label}</td>
                <td className="px-4 py-2 text-right">{sol(b.today)}</td>
                <td className="px-4 py-2 text-right">{sol(b.d7)}</td>
                <td className="px-4 py-2 text-right">{sol(b.d30)}</td>
                <td className="px-4 py-2 text-right">{sol(b.all)}</td>
                <td className="px-4 py-2 text-right text-text-2">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-2">
        <p>
          Fee wallet <span className="font-mono text-cyan">{e.fee_wallet ? short(e.fee_wallet) : "not set"}</span>
          {e.fee_wallet_balance != null && (
            <>
              {" "}
              holds <span className="font-mono tabular-nums text-text">{sol(e.fee_wallet_balance)}</span> on chain now
            </>
          )}
          {e.pending_transfers > 0 && ` · ${e.pending_transfers} transfers still settling`}
        </p>
        <div className="flex gap-2">
          <ExportButton kind="trades" label="Export trades" />
          <ExportButton kind="transfers" label="Export transfers" />
        </div>
      </div>
      <p className="text-[11px] leading-5 text-muted">From Kixo&apos;s own records: confirmed real trades and confirmed deposits and withdrawals. Nothing is estimated. The on-chain balance is a cross-check and also includes anything sent to the fee wallet another way</p>
    </div>
  );
}
