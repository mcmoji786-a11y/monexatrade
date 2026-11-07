"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ExternalLink, Loader2, Search, Stethoscope } from "lucide-react";
import { accessToken, activeWallet, useAccount } from "@/lib/account";
import { useMode } from "@/lib/demo";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { ARTICLES, TOPICS } from "@/lib/help";
import { useTradeConfig } from "@/lib/trade";
import { CATEGORIES, createTicket, diagnose, getTicket, listTickets, replyTicket, STATUS_LABEL, ticketContext, useSupportEvents, type Category, type Diagnosis, type Message, type Ticket } from "@/lib/support";

/** Support: system status, the Transaction Doctor, the help center and tickets. */
export function SupportBoard() {
  const [prefill, setPrefill] = useState<{ category: Category; subject: string; signature: string } | null>(null);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-text">Support</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">Check a transaction yourself in seconds, find an answer, or write to us. Every ticket includes what we need to help, so you do not have to explain twice</p>
        </div>
        <SystemStatus />
      </div>

      <TransactionDoctor onTicket={(d) => setPrefill({ category: "trade", subject: `${d.status === "failed" ? "Failed" : "Question about"} transaction ${d.signature.slice(0, 8)}…`, signature: d.signature })} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <HelpCenter />
        <Tickets prefill={prefill} onPrefillUsed={() => setPrefill(null)} />
      </div>
    </section>
  );
}

/* ---------------- Status ---------------- */

function SystemStatus() {
  const [h, setH] = useState<{ status: string; supabase: boolean; helius: boolean; stream_connected: boolean; primary?: boolean } | null>(null);
  const [down, setDown] = useState(false);
  const cfg = useTradeConfig();
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${GATEWAY_HTTP}/health`, { cache: "no-store" })
        .then((r) => r.json())
        .then((v) => alive && (setH(v), setDown(false)))
        .catch(() => alive && setDown(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const items: [string, boolean | null][] = [
    ["Platform", down ? false : h ? h.status === "ok" : null],
    ["Accounts", h ? h.supabase : down ? false : null],
    ["Solana data", h ? h.helius && h.stream_connected : down ? false : null],
    ["Real trading", cfg ? cfg.enabled && cfg.ready : null],
  ];
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-2" aria-label="System status">
      {items.map(([k, ok]) => (
        <div key={k} className="flex items-center gap-1.5 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${ok == null ? "bg-muted" : ok ? "bg-emerald" : k === "Real trading" ? "bg-muted" : "bg-negative"}`} />
          <dt className="text-text-2">{k}</dt>
          <dd className="text-muted">{ok == null ? "checking" : ok ? (k === "Real trading" ? "on" : k === "Solana data" && h?.primary === false ? "working on backup" : "working") : k === "Real trading" ? "off" : "down"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Transaction Doctor ---------------- */

type RealTrade = { signature: string; side: string; symbol: string; status: string; created_at: string };

function useRecentRealTrades() {
  const signedIn = useAccount().status === "signed-in";
  const [rows, setRows] = useState<RealTrade[]>([]);
  useEffect(() => {
    const token = accessToken();
    if (!signedIn || !token) return;
    fetch(`${GATEWAY_HTTP}/trade/history`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((v: RealTrade[]) => setRows(Array.isArray(v) ? v.slice(0, 6) : []))
      .catch(() => {});
  }, [signedIn]);
  return rows;
}

const TONE: Record<Diagnosis["status"], string> = { confirmed: "text-positive", failed: "text-negative", pending: "text-warning", not_found: "text-text-2" };
const WORD: Record<Diagnosis["status"], string> = { confirmed: "Confirmed", failed: "Failed", pending: "Processing", not_found: "Not on chain" };

function TransactionDoctor({ onTicket }: { onTicket: (d: Diagnosis) => void }) {
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Diagnosis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const recent = useRecentRealTrades();
  const run = async (s: string) => {
    const v = s.trim().replace(/^https?:\/\/[^/]+\/tx\//, "").split(/[?#\s]/)[0];
    setSig(v);
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await diagnose(v));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-start gap-2 border-b border-border px-5 py-4">
        <Stethoscope size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-emerald" />
        <div>
          <h2 className="text-sm font-medium text-text">Transaction Doctor</h2>
          <p className="text-xs text-text-2">Paste a transaction signature or Solscan link. It reads the chain and tells you what happened, what it cost and what to do</p>
        </div>
      </header>
      <div className="p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (sig.trim()) run(sig);
          }}
          className="flex gap-2"
        >
          <input
            value={sig}
            onChange={(e) => setSig(e.target.value)}
            placeholder="Transaction signature or solscan.io/tx/… link"
            spellCheck={false}
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 font-mono text-sm text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50"
          />
          <button type="submit" disabled={busy || !sig.trim()} className="flex h-10 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-40">
            {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            Check
          </button>
        </form>
        {recent.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Your recent trades</span>
            {recent.map((t) => (
              <button key={t.signature} type="button" onClick={() => run(t.signature)} className="rounded-full border border-border px-2 py-0.5 font-mono text-text-2 hover:border-cyan/40 hover:text-text">
                {t.side} {t.symbol || t.signature.slice(0, 4)} · {t.status}
              </button>
            ))}
          </div>
        )}
        {err && <p className="mt-3 text-sm text-negative">{err}</p>}
        {res && <DiagnosisView d={res} onTicket={() => onTicket(res)} />}
      </div>
    </section>
  );
}

function DiagnosisView({ d, onTicket }: { d: Diagnosis; onTicket: () => void }) {
  const sol = (l?: number | null) => (l == null ? "—" : `${l >= 0 ? "+" : "−"}${(Math.abs(l) / 1e9).toFixed(6)} SOL`);
  return (
    <div className="fade-up mt-4 rounded-lg border border-border bg-bg/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-xs font-medium ${TONE[d.status]}`}>{WORD[d.status]}</p>
          <p className="mt-1 text-base text-text">{d.title}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-2">{d.explain}</p>
          <p className="mt-2 text-sm text-text">
            <span className="text-muted">What to do: </span>
            {d.next}
          </p>
        </div>
        <a href={d.explorer} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-xs text-text-2 hover:text-text">
          Solscan <ExternalLink size={12} strokeWidth={1.5} />
        </a>
      </div>
      {(d.status === "confirmed" || d.status === "failed") && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-border pt-3 font-mono text-xs sm:grid-cols-4">
          <Fact k="When" v={d.time ? new Date(d.time * 1000).toLocaleString() : "—"} />
          <Fact k="Network fee" v={d.fee_lamports != null ? `${(d.fee_lamports / 1e9).toFixed(6)} SOL` : "—"} />
          <Fact k="SOL change of payer" v={sol(d.sol_change_lamports)} />
          <Fact k="Tokens changed" v={d.token_changes?.length ? d.token_changes.map((t) => `${t.change > 0 ? "+" : ""}${t.change.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${t.mint.slice(0, 4)}…`).join(", ") : "none"} />
        </dl>
      )}
      {d.ours && (
        <p className="mt-3 text-xs text-text-2">
          A Kixo {d.ours.side} of {d.ours.symbol || "a coin"}: recorded as <span className="text-text">{d.ours.status}</span>, platform fee {(d.ours.platform_fee_lamports / 1e9).toFixed(6)} SOL
        </p>
      )}
      {d.logs && d.logs.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-text-2">Technical details</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap text-muted">{d.logs.join("\n")}</pre>
        </details>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs">
        <span className="text-muted">Still need help?</span>
        <button type="button" onClick={onTicket} className="rounded-lg border border-border px-3 py-1.5 text-text-2 hover:bg-surface-2 hover:text-text">
          Open a ticket about this transaction
        </button>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-sans text-muted">{k}</dt>
      <dd className="mt-0.5 truncate text-text-2" title={v}>
        {v}
      </dd>
    </div>
  );
}

/* ---------------- Help center ---------------- */

function HelpCenter() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(() => ARTICLES.filter((a) => words.every((w) => `${a.q} ${a.a.join(" ")} ${a.topic}`.toLowerCase().includes(w))), [words]);
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-medium text-text">Help center</h2>
        <label className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <Search size={14} strokeWidth={1.5} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search answers" aria-label="Search help articles" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted" />
        </label>
      </header>
      <div className="px-2 py-2">
        {hits.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No answer matches. Open a ticket and we will help</p>}
        {TOPICS.map((topic) => {
          const list = hits.filter((a) => a.topic === topic);
          if (!list.length) return null;
          return (
            <div key={topic} className="py-2">
              <p className="px-3 pb-1 text-xs text-muted">{topic}</p>
              {list.map((a) => {
                const isOpen = open === a.id || words.length > 0;
                return (
                  <div key={a.id} className="rounded-lg">
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-text hover:bg-surface-2">
                      {a.q}
                      <ChevronDown size={14} strokeWidth={1.5} className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="flex flex-col gap-2 px-3 pt-1 pb-3 text-sm leading-relaxed text-text-2">
                        {a.a.map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Tickets ---------------- */

const STATUS_TONE: Record<string, string> = { open: "border-cyan/30 text-cyan", in_progress: "border-warning/30 text-warning", waiting: "border-emerald/40 text-emerald", resolved: "border-border text-muted" };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Tickets({ prefill, onPrefillUsed }: { prefill: { category: Category; subject: string; signature: string } | null; onPrefillUsed: () => void }) {
  const [list, setList] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<{ kind: "list" } | { kind: "new" } | { kind: "ticket"; id: number }>({ kind: "list" });
  const reload = () =>
    listTickets()
      .then((v) => (setList(v), setError(null)))
      .catch((e) => setError(e instanceof Error && /not set up yet/.test(e.message) ? "Tickets open soon. Until then the help center and Transaction Doctor work" : "Could not load your tickets. Try again in a minute"));
  useEffect(() => {
    reload();
  }, []);
  // New replies and status changes arrive live.
  useSupportEvents((e) => {
    if (view.kind === "list" && (e.type === "message" || e.type === "status" || e.type === "new")) reload();
  }, true);
  // "Open a ticket about this transaction" from the doctor.
  const [prevPrefill, setPrevPrefill] = useState(prefill);
  if (prefill !== prevPrefill) {
    setPrevPrefill(prefill);
    if (prefill) setView({ kind: "new" });
  }

  return (
    <section className="rounded-xl border border-border bg-surface">
      {view.kind === "list" && (
        <>
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-medium text-text">Your tickets</h2>
              <p className="text-xs text-text-2">We reply here. You will see a mark on Support when we do</p>
            </div>
            <button type="button" onClick={() => setView({ kind: "new" })} className="h-8 rounded-lg bg-text px-3 text-xs font-medium text-bg">
              New ticket
            </button>
          </header>
          {!list ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{error ?? "Loading"}</p>
          ) : list.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No tickets yet. Most answers are in the help center and the Transaction Doctor</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setView({ kind: "ticket", id: t.id })} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.user_unread ? "bg-emerald" : "bg-transparent"}`} aria-label={t.user_unread ? "New reply" : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">{t.subject}</span>
                      <span className="block text-xs text-muted">
                        #{t.id} · {CATEGORIES.find((c) => c.value === t.category)?.label} · {ago(t.updated_at)}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded border px-1.5 py-px text-[11px] ${STATUS_TONE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {view.kind === "new" && (
        <NewTicket
          prefill={prefill}
          onCancel={() => (onPrefillUsed(), setView({ kind: "list" }))}
          onCreated={(id) => {
            onPrefillUsed();
            reload();
            setView({ kind: "ticket", id });
          }}
        />
      )}
      {view.kind === "ticket" && <TicketThread id={view.id} onBack={() => (reload(), setView({ kind: "list" }))} />}
    </section>
  );
}

function NewTicket({ prefill, onCancel, onCreated }: { prefill: { category: Category; subject: string; signature: string } | null; onCancel: () => void; onCreated: (id: number) => void }) {
  const account = useAccount();
  const mode = useMode();
  const [f, setF] = useState({ category: prefill?.category ?? ("trade" as Category), subject: prefill?.subject ?? "", body: "", signature: prefill?.signature ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = f.subject.trim().length >= 3 && f.body.trim().length >= 10;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const { id } = await createTicket({ ...f, signature: f.signature.trim() || undefined, context: ticketContext(mode, activeWallet(account)) });
          onCreated(id);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <header className="flex items-center gap-2 border-b border-border px-5 py-4">
        <button type="button" onClick={onCancel} aria-label="Back to tickets" className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text">
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <h2 className="text-sm font-medium text-text">New ticket</h2>
      </header>
      <div className="flex flex-col gap-4 p-5">
        <Field label="Topic">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.value} type="button" aria-pressed={f.category === c.value} onClick={() => setF({ ...f, category: c.value })} className={`rounded-lg border px-3 py-1.5 text-xs ${f.category === c.value ? "border-emerald/50 bg-surface-3 text-text" : "border-border text-text-2 hover:text-text"}`}>
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Subject">
          <input value={f.subject} maxLength={140} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="In a few words" className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50" />
        </Field>
        <Field label={f.category === "bug" ? "What happened, and the steps to see it again" : "What happened"}>
          <textarea value={f.body} maxLength={5000} rows={6} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={f.category === "bug" ? "1. I opened…\n2. I clicked…\n3. I expected… but saw…" : "The more detail, the faster we can help"} className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50" />
        </Field>
        {(f.category === "trade" || f.signature) && (
          <Field label="Transaction signature (optional)">
            <input value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} spellCheck={false} placeholder="Paste it so we can read the transaction" className="h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-xs text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50" />
          </Field>
        )}
        <p className="text-xs text-muted">We attach the page you came from, your browser, screen size, account mode and connected wallet address, so you do not have to. Never send your seed phrase: we will never ask for it</p>
        {err && <p className="text-sm text-negative">{err}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={!ok || busy} className="flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-40">
            {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            Send
          </button>
          <button type="button" onClick={onCancel} className="h-9 px-3 text-sm text-text-2 hover:text-text">
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-text-2">{label}</p>
      {children}
    </div>
  );
}

function TicketThread({ id, onBack }: { id: number; onBack: () => void }) {
  const [data, setData] = useState<{ ticket: Ticket; messages: Message[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    getTicket(id)
      .then((d) => {
        setData(d);
        window.dispatchEvent(new Event("mx:support-read"));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the ticket changes
  }, [id]);
  useSupportEvents((e) => {
    if (e.ticket === id && (e.type === "message" || e.type === "status" || e.type === "read")) load();
  }, true);
  const t = data?.ticket;
  return (
    <div>
      <header className="flex items-center gap-2 border-b border-border px-5 py-4">
        <button type="button" onClick={onBack} aria-label="Back to tickets" className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text">
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-text">{t?.subject ?? `Ticket #${id}`}</h2>
          {t && (
            <p className="text-xs text-muted">
              #{t.id} · {CATEGORIES.find((c) => c.value === t.category)?.label} · opened {ago(t.created_at)}
            </p>
          )}
        </div>
        {t && <span className={`shrink-0 rounded border px-1.5 py-px text-[11px] ${STATUS_TONE[t.status]}`}>{STATUS_LABEL[t.status]}</span>}
      </header>
      {!data ? (
        <p className="px-5 py-8 text-center text-sm text-muted">{err ?? "Loading"}</p>
      ) : (
        <>
          {t?.signature && (
            <p className="border-b border-border px-5 py-2 font-mono text-xs text-muted">
              Transaction{" "}
              <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer" className="text-cyan hover:underline">
                {t.signature.slice(0, 16)}…
              </a>
            </p>
          )}
          <ol className="flex max-h-[460px] flex-col gap-3 overflow-y-auto px-5 py-4">
            {data.messages.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-xl border px-3 py-2 ${m.author === "user" ? "self-end border-border bg-surface-2" : "self-start border-emerald/25 bg-emerald/5"}`}>
                <p className="text-[11px] text-muted">
                  {m.author === "user" ? "You" : m.agent ? `${m.agent}, Kixo support` : "Kixo support"} · {ago(m.created_at)}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-text">{m.body}</p>
              </li>
            ))}
          </ol>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              setBusy(true);
              try {
                await replyTicket(id, text);
                setText("");
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            className="flex gap-2 border-t border-border p-4"
          >
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={5000} placeholder={t?.status === "resolved" ? "Reply to reopen this ticket" : "Write a reply"} className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50" />
            <button type="submit" disabled={busy || !text.trim()} className="h-9 self-end rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-40">
              {busy ? "Sending" : "Send"}
            </button>
          </form>
          {err && <p className="px-4 pb-3 text-xs text-negative">{err}</p>}
        </>
      )}
    </div>
  );
}
