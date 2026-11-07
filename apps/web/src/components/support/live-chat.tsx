"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, MessageCircle, Stethoscope, X } from "lucide-react";
import { activeWallet, useAccount } from "@/lib/account";
import { useMode } from "@/lib/demo";
import { useFeatures } from "@/lib/features";
import { useNews } from "@/lib/news";
import { diagnose, isSecretRefusal, liveCurrent, replyTicket, sendTyping, startChat, ticketContext, useSupportEvents, type Diagnosis, type LiveState } from "@/lib/support";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Live chat with the support team: a small button on every page, a panel above it. */
export function LiveChat() {
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  const features = useFeatures();
  const enabled = features.support && features.live_chat;
  const mode = useMode();
  const pathname = usePathname();
  // Beside the news panel when it is open (desktop), not on top of it.
  const newsOpen = useNews(false).open && features.news && pathname !== "/news";
  const right = newsOpen ? "right-4 lg:right-99" : "right-4";

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LiveState | null>(null);
  const [online, setOnline] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [closedNote, setClosedNote] = useState(false);
  const [doctor, setDoctor] = useState(false);
  const openRef = useRef(open);
  const hadChat = useRef(false);
  const lastTyping = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const apply = (s: LiveState) => {
    if (hadChat.current && !s.chat) setClosedNote(true);
    hadChat.current = !!s.chat;
    setState(s);
    setOnline(s.online);
  };
  // When the gateway or the tables are not ready, show the start screen; sending then
  // explains that chat is not open yet.
  const fallback = () => setState((s) => s ?? { enabled: true, online: false, chat: null });
  const reload = (peek: boolean) => liveCurrent(peek).then(apply, fallback);

  useEffect(() => {
    openRef.current = open;
    if (!signedIn || !enabled) return;
    liveCurrent(!open).then(apply, fallback);
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, signedIn, enabled]);

  useSupportEvents((e) => {
    if (e.type === "hello" || e.type === "presence") setOnline(!!e.online);
    else if (e.type === "typing" && e.who === "support" && e.ticket === state?.chat?.ticket.id) {
      setTyping(e.agent || "Support");
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 4_000);
    } else if (e.type === "message" || e.type === "new" || e.type === "read" || e.type === "status") {
      if (e.type === "message") setTyping(null);
      reload(!openRef.current);
    }
  }, signedIn && enabled);

  const messages = state?.chat?.messages;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, sending, typing, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!signedIn || !enabled) return null;
  const chat = state?.chat ?? null;
  const unread = !open && !!chat?.ticket.user_unread;
  const last = chat?.messages.at(-1);
  const seen = last?.author === "user" && chat?.ticket.admin_unread === false;

  const send = async (body: string) => {
    const b = body.trim();
    if (!b) return;
    setErr(null);
    setSending(b);
    setText("");
    try {
      if (chat) await replyTicket(chat.ticket.id, b);
      else await startChat(b, ticketContext(mode, activeWallet(account)));
      setClosedNote(false);
      await reload(false);
    } catch (e) {
      // A pasted recovery phrase is refused and cleared from the box on purpose.
      if (!isSecretRefusal(e)) setText(b);
      const m = e instanceof Error ? e.message : String(e);
      setErr(/not set up yet/.test(m) ? "Chat opens soon. Until then, open a ticket on the Support page" : m);
    } finally {
      setSending(null);
    }
  };

  // On the trade page the button is icon only, so it covers as little as possible.
  const compact = pathname.startsWith("/token/");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Close support chat" : `Chat with support${unread ? ", new reply" : ""}`}
        title={compact ? (online ? "Support: online now" : "Support") : undefined}
        className={`fixed ${right} bottom-4 z-40 flex h-10 items-center gap-2 rounded-full border border-border bg-surface-2 text-sm text-text shadow-lg shadow-black/30 transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-emerald ${compact ? "w-10 justify-center" : "pr-4 pl-3"}`}
      >
        <span className="relative">
          <MessageCircle size={16} strokeWidth={1.5} className="text-text-2" />
          {(unread || (compact && online)) && <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ring-2 ring-surface-2 ${unread ? "bg-emerald" : "bg-emerald/70"}`} />}
        </span>
        {!compact && (
          <>
            Support
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald" : "bg-muted"}`} aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Support chat"
          className={`fade-up fixed ${right} bottom-18 left-4 z-40 flex max-h-[calc(100dvh-140px)] flex-col rounded-2xl border border-border bg-surface shadow-2xl shadow-black/50 sm:left-auto sm:w-95 ${chat || sending ? "h-[min(560px,calc(100dvh-140px))]" : ""}`}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-text">Kixo support</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-2">
                <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald" : "bg-muted"}`} />
                {online ? "Online now" : "Offline. Leave a message and we reply here"}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text">
              <X size={16} strokeWidth={1.5} />
            </button>
          </header>

          <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-4" aria-live="polite">
            {!state ? (
              <li className="m-auto text-xs text-muted">Loading</li>
            ) : !chat && !sending ? (
              <li className="flex flex-col gap-3 text-sm text-text-2">
                {closedNote && <p className="rounded-lg border border-border px-3 py-2 text-xs">Your last chat was closed. Start a new one any time; it stays on your Support page</p>}
                <p>{online ? "Ask anything about Kixo, a trade or your wallet. Someone from the team answers here." : "The team is not online right now. Write your question: it is saved, and the reply comes here and on your Support page."}</p>
                <p className="text-xs text-muted">We never ask for your recovery phrase or private key. Never share them with anyone</p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button type="button" onClick={() => setDoctor(true)} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-text-2 hover:bg-surface-2 hover:text-text">
                    <Stethoscope size={13} strokeWidth={1.5} />
                    Check a transaction
                  </button>
                  <Link href="/support" onClick={() => setOpen(false)} className="rounded-lg border border-border px-2.5 py-1.5 text-text-2 hover:bg-surface-2 hover:text-text">
                    Help center
                  </Link>
                </div>
              </li>
            ) : (
              <>
                {chat?.messages.map((m) => (
                  <li key={m.id} className={`flex max-w-[85%] flex-col ${m.author === "user" ? "self-end items-end" : "self-start items-start"}`}>
                    {m.author === "support" && <span className="mb-0.5 text-[11px] text-muted">{m.agent ? `${m.agent}, Kixo support` : "Kixo support"}</span>}
                    <p className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${m.author === "user" ? "bg-surface-3 text-text" : "border border-emerald/25 bg-emerald/5 text-text"}`}>{m.body}</p>
                    <span className="mt-0.5 font-mono text-[10px] text-muted">{time(m.created_at)}</span>
                  </li>
                ))}
                {sending && (
                  <li className="flex max-w-[85%] flex-col items-end self-end opacity-60">
                    <p className="rounded-xl bg-surface-3 px-3 py-2 text-sm whitespace-pre-wrap text-text">{sending}</p>
                    <span className="mt-0.5 text-[10px] text-muted">Sending</span>
                  </li>
                )}
                {seen && !sending && <li className="-mt-1 self-end text-[10px] text-muted">Seen</li>}
                {typing && <li className="self-start text-xs text-text-2">{typing} is typing…</li>}
                {chat && !online && last?.author === "user" && !typing && <li className="self-center pt-2 text-center text-xs text-muted">The team is offline. Your message is saved and the reply comes here</li>}
              </>
            )}
          </ol>

          {doctor && <ChatDoctor onClose={() => setDoctor(false)} onShare={(d) => (setDoctor(false), send(`Please check this transaction: ${d.signature}\nWhat Kixo found: ${d.title}`))} />}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            className="border-t border-border p-3"
          >
            {err && <p className="mb-2 text-xs text-negative">{err}</p>}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={text}
                rows={1}
                maxLength={5000}
                onChange={(e) => {
                  setText(e.target.value);
                  if (chat && Date.now() - lastTyping.current > 2_000) {
                    lastTyping.current = Date.now();
                    sendTyping(chat.ticket.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(text);
                  }
                }}
                placeholder={chat ? "Write a message" : "Your question"}
                aria-label="Message"
                className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
              />
              {chat && !doctor && (
                <button type="button" onClick={() => setDoctor(true)} title="Check a transaction" aria-label="Check a transaction" className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-text-2 hover:bg-surface-2 hover:text-text">
                  <Stethoscope size={15} strokeWidth={1.5} />
                </button>
              )}
              <button type="submit" disabled={!text.trim() || !!sending} className="h-9 shrink-0 rounded-lg bg-text px-3 text-sm font-medium text-bg disabled:opacity-40">
                Send
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

/** The Transaction Doctor inside the chat: check, then share the result with support. */
function ChatDoctor({ onClose, onShare }: { onClose: () => void; onShare: (d: Diagnosis) => void }) {
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Diagnosis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tone = res?.status === "confirmed" ? "text-positive" : res?.status === "failed" ? "text-negative" : "text-warning";
  return (
    <div className="border-t border-border bg-bg/50 px-3 py-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-text-2">Check a transaction</span>
        <button type="button" onClick={onClose} aria-label="Close transaction check" className="text-muted hover:text-text">
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = sig.trim().replace(/^https?:\/\/[^/]+\/tx\//, "").split(/[?#\s]/)[0];
          if (!v) return;
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
        }}
        className="flex gap-2"
      >
        <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Signature or Solscan link" spellCheck={false} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-bg px-2.5 font-mono text-xs text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50" />
        <button type="submit" disabled={busy || !sig.trim()} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-text disabled:opacity-40">
          {busy && <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />}
          Check
        </button>
      </form>
      {err && <p className="mt-2 text-xs text-negative">{err}</p>}
      {res && (
        <div className="mt-2 text-xs">
          <p className={tone}>{res.title}</p>
          <p className="mt-0.5 text-text-2">{res.next}</p>
          <button type="button" onClick={() => onShare(res)} className="mt-2 rounded-lg border border-border px-2.5 py-1 text-text-2 hover:bg-surface-2 hover:text-text">
            Share with support
          </button>
        </div>
      )}
    </div>
  );
}
