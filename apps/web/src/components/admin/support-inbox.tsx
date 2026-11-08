"use client";

import { adminKey } from "@/lib/admin";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { GATEWAY_WS } from "@/lib/gateway";
import { playTone } from "@/lib/settings";
import { adminClaim, adminPresence, adminReply, adminSetPresence, adminTicket, adminTickets, adminUpdate, CATEGORIES, STATUS_LABEL, type Message, type Status, type SupportEvent, type TeamPresence, type Ticket } from "@/lib/support";

/* Support inbox for the team: tickets and live chats. Needs ADMIN_TOKEN, typed here and
   never stored. The agent's first name is remembered on this computer for convenience. */

const FILTERS: { key: string; label: string }[] = [
  { key: "live", label: "Live chats" },
  { key: "active", label: "All active" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting", label: "Waiting for user" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];
const STATUSES: Status[] = ["open", "in_progress", "waiting", "resolved"];
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const PRIORITY_TONE: Record<string, string> = { low: "text-muted", normal: "text-text-2", high: "text-warning", urgent: "text-negative" };
/** Without any activity in the inbox for this long, the agent stops counting as online. */
const IDLE_MS = 10 * 60_000;
const NAME_KEY = "mx.agent";

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function SupportInbox() {
  const [key, setKey] = useState(() => adminKey() ?? "");
  const [agent, setAgent] = useState(savedName);
  const [unlocked, setUnlocked] = useState(false);
  const [filter, setFilter] = useState("live");
  const [list, setList] = useState<Ticket[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [presence, setPresence] = useState<TeamPresence | null>(null);
  const [pulse, setPulse] = useState<{ ticket: number; n: number }>({ ticket: 0, n: 0 });
  const [userTyping, setUserTyping] = useState<number | null>(null);
  const sockRef = useRef<WebSocket | null>(null);
  const switchRef = useRef(false);
  const lastActive = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The list.
  useEffect(() => {
    if (!unlocked) return;
    let alive = true;
    const load = () =>
      adminTickets(key, filter === "live" ? "active" : filter)
        .then((v) => alive && (setList(filter === "live" ? v.filter((t) => t.channel === "live") : v), setErr(null)))
        .catch((e) => {
          if (!alive) return;
          setErr(e instanceof Error ? e.message : String(e));
          if (e instanceof Error && e.message === "Wrong admin key") setUnlocked(false);
        });
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // The key is only read once unlocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, filter, tick]);

  // The live socket, the heartbeat and the Online switch.
  const onEvent = useRef<(e: SupportEvent) => void>(() => {});
  useEffect(() => {
    onEvent.current = (e) => {
      if (e.type === "error") {
        setErr(e.error ?? "Live updates stopped");
        return;
      }
      if (e.type === "presence" || e.type === "hello") {
        setPresence((p) => (p ? { ...p, online: !!e.online } : p));
        return;
      }
      if (e.type === "typing" && e.who === "user" && e.ticket) {
        setUserTyping(e.ticket);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setUserTyping(null), 4_000);
        return;
      }
      if (e.type === "new" && e.live) playTone(true);
      if (e.type === "message" && e.ticket) setUserTyping((t) => (t === e.ticket ? null : t));
      if (e.ticket) setPulse((p) => ({ ticket: e.ticket!, n: p.n + 1 }));
      // Several events often arrive together: reload the list once.
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => setTick((n) => n + 1), 300);
    };
  });
  useEffect(() => {
    if (!unlocked) return;
    let alive = true;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const ws = new WebSocket(`${GATEWAY_WS}/support/ws`);
      sockRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ admin: key }));
        retry = 0;
      };
      ws.onmessage = (m) => {
        try {
          onEvent.current(JSON.parse(String(m.data)));
        } catch {}
      };
      ws.onclose = () => {
        if (sockRef.current === ws) sockRef.current = null;
        if (alive) timer = setTimeout(open, Math.min(30_000, 1_000 * 2 ** retry++));
      };
    };
    open();
    adminPresence(key)
      .then((p) => {
        switchRef.current = p.switch;
        setPresence(p);
      })
      .catch(() => {});
    const beat = () => {
      if (switchRef.current && Date.now() - lastActive.current < IDLE_MS && sockRef.current?.readyState === WebSocket.OPEN) sockRef.current.send(JSON.stringify({ type: "beat" }));
    };
    const iv = setInterval(beat, 30_000);
    lastActive.current = Date.now();
    const active = () => {
      const wasIdle = Date.now() - lastActive.current > 60_000;
      lastActive.current = Date.now();
      if (wasIdle) beat();
    };
    window.addEventListener("pointerdown", active);
    window.addEventListener("keydown", active);
    window.addEventListener("pointermove", active, { passive: true });
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(iv);
      sockRef.current?.close();
      sockRef.current = null;
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      window.removeEventListener("pointermove", active);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  // Unread live chats show in the tab title, so an agent sees them from another tab.
  const unreadLive = list?.filter((t) => t.admin_unread && t.channel === "live").length ?? 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = unreadLive ? `(${unreadLive}) ${base}` : base;
    return () => {
      document.title = document.title.replace(/^\(\d+\) /, "");
    };
  }, [unreadLive]);

  if (!unlocked) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            localStorage.setItem(NAME_KEY, agent.trim());
          } catch {}
          setErr(null);
          setList(null);
          setUnlocked(true);
        }}
        className="max-w-md rounded-2xl border border-border bg-surface p-5"
      >
        <p className="text-sm font-medium">Open the support inbox</p>
        <p className="mt-1 text-xs text-text-2">Users see your first name on your replies. The admin key (ADMIN_TOKEN in the gateway .env) stays in this tab only and is never saved</p>
        <input value={agent} onChange={(e) => setAgent(e.target.value.slice(0, 24))} placeholder="Your first name" autoComplete="off" className="mt-3 h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-emerald/50" />
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Admin key" autoComplete="off" className="mt-2 h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-sm outline-none placeholder:text-muted focus:border-emerald/50" />
        <button type="submit" disabled={key.length < 16 || agent.trim().length < 2} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-text text-sm font-medium text-bg disabled:opacity-40">
          <KeyRound size={13} strokeWidth={1.5} />
          Open inbox
        </button>
        {err && <p className="mt-2 text-xs text-negative">{err}</p>}
      </form>
    );
  }

  const unread = list?.filter((t) => t.admin_unread).length ?? 0;
  const toggleOnline = async () => {
    if (!presence) return;
    try {
      const p = await adminSetPresence(key, !presence.switch);
      switchRef.current = p.switch;
      lastActive.current = Date.now();
      setPresence(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-3">
        <div className="text-sm">
          <span className="text-text">Live chat</span>
          <span className="ml-2 text-xs text-text-2">
            {!presence
              ? "Checking"
              : !presence.enabled
                ? "Switched off in Features"
                : presence.online
                  ? `Online as ${agent.trim()}. Users can chat with the team now`
                  : presence.switch
                    ? "Away: no activity here for 10 minutes. Move the mouse or type to come back"
                    : "Offline. New chats are saved and wait here"}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!presence?.switch}
          onClick={toggleOnline}
          disabled={!presence?.enabled}
          className="flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-xs text-text-2 hover:text-text disabled:opacity-40"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${presence?.online ? "bg-emerald" : "bg-muted"}`} />
          {presence?.switch ? "Go offline" : "Go online"}
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col rounded-2xl border border-border bg-surface">
          <div className="flex flex-wrap gap-1 border-b border-border p-3">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => (setFilter(f.key), setList(null))} className={`rounded-lg px-2.5 py-1 text-xs ${filter === f.key ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="border-b border-border px-4 py-2 text-xs text-muted">
            {list ? `${list.length} ${filter === "live" ? "chats" : "tickets"}` : "Loading"}
            {unread > 0 && <span className="text-emerald"> · {unread} with new messages</span>}
          </p>
          {err && <p className="px-4 py-3 text-xs text-negative">{err}</p>}
          <ul className="max-h-[680px] divide-y divide-border overflow-y-auto">
            {list?.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing here</li>}
            {list?.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpenId(t.id)} className={`flex w-full items-start gap-3 px-4 py-3 text-left ${openId === t.id ? "bg-surface-3" : "hover:bg-surface-2"}`}>
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${t.admin_unread ? "bg-emerald" : "bg-transparent"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {t.channel === "live" && <span className="mr-1.5 rounded border border-cyan/30 px-1 text-[10px] text-cyan">Live</span>}
                      {t.subject}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      #{t.id} · {t.email ?? "no email"}
                      {userTyping === t.id ? <span className="text-text-2"> · typing…</span> : t.agent ? ` · ${t.agent}` : " · unassigned"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px]">
                    <span className="block text-text-2">{STATUS_LABEL[t.status]}</span>
                    <span className={`block ${PRIORITY_TONE[t.priority]}`}>
                      {t.priority} · {ago(t.updated_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {openId == null ? (
          <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-muted">Pick a ticket or chat to read it</div>
        ) : (
          <Thread
            key={openId}
            id={openId}
            adminKey={key}
            agent={agent.trim()}
            pulse={pulse.ticket === openId ? pulse.n : 0}
            userTyping={userTyping === openId}
            onTyping={() => sockRef.current?.readyState === WebSocket.OPEN && sockRef.current.send(JSON.stringify({ type: "typing", ticket: openId, agent: agent.trim() }))}
            onChanged={() => setTick((n) => n + 1)}
          />
        )}
      </div>
    </div>
  );
}

function Thread({ id, adminKey, agent, pulse, userTyping, onTyping, onChanged }: { id: number; adminKey: string; agent: string; pulse: number; userTyping: boolean; onTyping: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ ticket: Ticket; messages: Message[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastTyping = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const load = () =>
    adminTicket(adminKey, id)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  // First open, and again whenever a live event names this ticket.
  useEffect(() => {
    load().then(onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per ticket
  }, []);
  useEffect(() => {
    if (pulse) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data?.messages.length, userTyping]);

  const t = data?.ticket;
  const patch = async (p: { status?: Status; priority?: string }) => {
    try {
      await adminUpdate(adminKey, id, p);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const claim = async (force: boolean) => {
    try {
      setErr(null);
      await adminClaim(adminKey, id, agent, force);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  if (!t) return <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-muted">{err ?? "Loading"}</div>;
  const ctx = t.context ?? {};
  const mine = t.agent === agent;
  const lastPublic = data.messages.filter((m) => !m.internal).at(-1);
  const seen = lastPublic?.author === "support" && t.user_unread === false;
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
          <p className="text-base">
            {t.channel === "live" && <span className="mr-2 rounded border border-cyan/30 px-1 align-middle text-[10px] text-cyan">Live</span>}
            {t.subject}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            #{t.id} · {t.email ?? "no email"} · {CATEGORIES.find((c) => c.value === t.category)?.label} · opened {ago(t.created_at)} ago
          </p>
          <p className="mt-1 text-xs">
            {t.agent ? (
              <span className={mine ? "text-emerald" : "text-text-2"}>{mine ? "You are on this one" : `${t.agent} is on this one`}</span>
            ) : (
              <span className="text-warning">Nobody has taken this yet</span>
            )}
            {!mine && (
              <button type="button" onClick={() => claim(!!t.agent)} className="ml-3 rounded-md border border-border px-2 py-0.5 text-text-2 hover:text-text">
                {t.agent ? `Take over from ${t.agent}` : "Take this"}
              </button>
            )}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-text-2">
            Status
            <select value={t.status} onChange={(e) => patch({ status: e.target.value as Status })} className="h-8 rounded-lg border border-border bg-bg px-2 text-text outline-none focus:border-emerald/50">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-text-2">
            Priority
            <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })} className="h-8 rounded-lg border border-border bg-bg px-2 text-text outline-none focus:border-emerald/50">
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-2 border-b border-border px-5 py-3 text-xs sm:grid-cols-3">
        <Ctx k="Mode" v={ctx.mode} />
        <Ctx k="Wallet" v={ctx.wallet} mono link={ctx.wallet ? `https://solscan.io/account/${ctx.wallet}` : undefined} />
        <Ctx k="Transaction" v={t.signature} mono link={t.signature ? `https://solscan.io/tx/${t.signature}` : undefined} />
        <Ctx k="Came from" v={ctx.page} />
        <Ctx k="Screen" v={ctx.screen} />
        <Ctx k="Browser" v={ctx.browser} />
      </dl>

      <ol ref={listRef} className="flex max-h-[520px] flex-col gap-3 overflow-y-auto px-5 py-4">
        {data.messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-xl border px-3 py-2 ${m.internal ? "self-center border-dashed border-warning/40 bg-warning/5" : m.author === "support" ? "self-end border-emerald/25 bg-emerald/5" : "self-start border-border bg-surface-2"}`}
          >
            <p className="text-[11px] text-muted">
              {m.internal ? `Internal note${m.agent ? `, ${m.agent}` : ""}` : m.author === "support" ? (m.agent ?? "Support") : "User"} · {ago(m.created_at)} ago
            </p>
            <p className="mt-1 text-sm whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
        {seen && <li className="-mt-2 self-end text-[10px] text-muted">Seen by the user</li>}
        {userTyping && <li className="self-start text-xs text-text-2">The user is typing…</li>}
      </ol>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setBusy(true);
          setErr(null);
          try {
            await adminReply(adminKey, id, text, internal, agent);
            setText("");
            await load();
            onChanged();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        className="border-t border-border p-4"
      >
        <div className="mb-2 flex gap-1 text-xs">
          <button type="button" aria-pressed={!internal} onClick={() => setInternal(false)} className={`rounded-lg px-2.5 py-1 ${!internal ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
            Reply to user
          </button>
          <button type="button" aria-pressed={internal} onClick={() => setInternal(true)} className={`rounded-lg px-2.5 py-1 ${internal ? "bg-surface-3 text-warning" : "text-text-2 hover:text-text"}`}>
            Internal note
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!internal && Date.now() - lastTyping.current > 2_000) {
              lastTyping.current = Date.now();
              onTyping();
            }
          }}
          onKeyDown={(e) => {
            // In a live chat Enter sends, as users expect; Shift+Enter adds a line.
            if (t.channel === "live" && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={t.channel === "live" ? 2 : 4}
          maxLength={5000}
          placeholder={internal ? "Only the team sees this" : t.channel === "live" ? "Reply. Enter sends, Shift+Enter adds a line" : "The user sees this and gets a mark on Support"}
          className={`w-full resize-y rounded-lg border bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted ${internal ? "border-warning/30 focus:border-warning/60" : "border-border focus:border-emerald/50"}`}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">{internal ? "Notes do not change the status" : t.agent ? "Sending sets the status to Waiting for user" : "Sending also makes this chat yours"}</p>
          <button type="submit" disabled={busy || !text.trim()} className="flex h-9 items-center gap-1.5 rounded-lg bg-text px-4 text-sm font-medium text-bg disabled:opacity-40">
            {busy && <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />}
            {internal ? "Add note" : "Send reply"}
          </button>
        </div>
        {err && <p className="mt-2 text-xs text-negative">{err}</p>}
      </form>
    </div>
  );
}

function Ctx({ k, v, mono, link }: { k: string; v?: string | null; mono?: boolean; link?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{k}</dt>
      <dd className={`mt-0.5 flex items-center gap-1 truncate text-text-2 ${mono ? "font-mono" : ""}`} title={v ?? undefined}>
        <span className="truncate">{v || "—"}</span>
        {link && v && (
          <a href={link} target="_blank" rel="noreferrer" aria-label={`Open ${k} on Solscan`} className="shrink-0 text-muted hover:text-text">
            <ExternalLink size={11} strokeWidth={1.5} />
          </a>
        )}
      </dd>
    </div>
  );
}
