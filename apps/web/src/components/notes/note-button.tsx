"use client";
/* "Note" next to a coin or a wallet: the user's own words about it, saved to the account.
   The popover also opens the list of every note, each a link back. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { NotebookPen, X } from "lucide-react";
import { openLogin } from "@/lib/account";
import { noteOf, saveNote, useNotes, type NoteKind } from "@/lib/notes";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";
import { useFeatures } from "@/lib/features";

export function NoteButton({ kind, target, label }: { kind: NoteKind; target: string; label: string }) {
  const f = useFeatures();
  const { notes, error, signedIn } = useNotes();
  const note = noteOf(notes, kind, target);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (!f.notes) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (signedIn ? setOpen((o) => !o) : openLogin())}
        aria-expanded={open}
        title={note ? note.body.slice(0, 120) : `Write a note about this ${kind}`}
        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors hover:bg-surface-2 ${note ? "border-emerald/40 text-text" : "border-border text-text-2"}`}
      >
        <NotebookPen size={14} strokeWidth={1.5} className={note ? "text-emerald" : ""} />
        Note
      </button>
      {open && <Editor key={note?.updated_at ?? "new"} kind={kind} target={target} label={label} initial={note?.body ?? ""} error={error} count={notes?.length ?? 0} onClose={() => setOpen(false)} onAll={() => (setOpen(false), setAll(true))} />}
      {all && createPortal(<AllNotes onClose={() => setAll(false)} />, document.body)}
    </div>
  );
}

function Editor({ kind, target, label, initial, error, count, onClose, onAll }: { kind: NoteKind; target: string; label: string; initial: string; error: string | null; count: number; onClose: () => void; onAll: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const save = async () => {
    if (text.trim() === initial.trim()) return onClose();
    setBusy(true);
    try {
      await saveNote(kind, target, text, label);
      pushToast({ tone: "good", title: text.trim() ? "Note saved" : "Note deleted" });
      onClose();
    } catch (e) {
      pushToast({ tone: "bad", title: "Note not saved", body: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-border bg-surface-2 p-3 shadow-lg">
      <p className="text-sm font-medium text-text">Your note on {label || (kind === "coin" ? "this coin" : "this wallet")}</p>
      <p className="mt-0.5 text-xs text-muted">Only you can see it, on every device you sign in on</p>
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
        }}
        maxLength={2000}
        rows={5}
        placeholder={kind === "coin" ? "Why you bought, your exit plan, what to watch" : "Who this is, what it trades, how good it is"}
        className="mt-2 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm leading-6 text-text outline-none placeholder:text-muted focus:border-emerald/50"
      />
      {error && <p className="mt-1 text-xs text-negative">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={onAll} className="text-xs text-text-2 hover:text-text">
          All notes{count ? ` (${count})` : ""}
        </button>
        <span className="ml-auto font-mono text-[11px] text-muted">{text.length}/2000</span>
        {initial && (
          <button type="button" disabled={busy} onClick={() => setText("")} className="h-8 rounded-lg px-2 text-xs text-muted hover:text-text">
            Clear
          </button>
        )}
        <button type="button" disabled={busy} onClick={save} className="h-8 rounded-lg bg-text px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-60">
          Save
        </button>
      </div>
    </div>
  );
}

function AllNotes({ onClose }: { onClose: () => void }) {
  const { notes } = useNotes();
  const [q, setQ] = useState("");
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const list = (notes ?? []).filter((n) => !q || `${n.label} ${n.body}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div role="dialog" aria-modal="true" aria-label="Your notes" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-surface" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-text">Your notes</p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" className="ml-auto h-8 w-40 rounded-lg border border-border bg-bg px-2.5 text-xs text-text outline-none placeholder:text-muted focus:border-emerald/50" />
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {list.length === 0 ? (
            <li className="px-6 py-10 text-center text-sm text-muted">{q ? "No note matches" : "No notes yet"}</li>
          ) : (
            list.map((n) => (
              <li key={`${n.kind}:${n.ref}`}>
                <Link href={n.kind === "coin" ? tokenHref(n.ref) : `/tracker?w=${n.ref}`} onClick={onClose} className="block px-4 py-3 hover:bg-surface-2">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm text-text">{n.label || `${n.ref.slice(0, 4)}…${n.ref.slice(-4)}`}</span>
                    <span className="text-[11px] text-muted">{n.kind}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted">{new Date(n.updated_at).toLocaleDateString()}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs whitespace-pre-line text-text-2">{n.body}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
