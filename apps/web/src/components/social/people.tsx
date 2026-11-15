"use client";
/* Finding people to follow: the Traders list with search, and the followers / following
   lists behind the counts on a profile (gateway social.rs traders and people). */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Search, Users, X } from "lucide-react";
import { getPeople, getTraders, type TraderRow } from "@/lib/social";
import { FollowButton, TraderAvatar } from "./social-bits";

function Rows({ rows, onFollow }: { rows: TraderRow[]; onFollow?: (handle: string, on: boolean) => void }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.handle} className="flex min-h-16 items-center gap-3 px-4 py-3">
          <Link href={`/u/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
            <TraderAvatar handle={r.handle} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm text-text hover:underline">{r.display_name || `@${r.handle}`}</span>
              <span className="block truncate font-mono text-[11px] text-muted">
                @{r.handle} · {r.followers} {r.followers === 1 ? "follower" : "followers"}
              </span>
              {r.bio && <span className="mt-0.5 block truncate text-xs text-text-2">{r.bio}</span>}
            </span>
          </Link>
          {r.me ? <span className="text-xs text-muted">You</span> : <FollowButton key={`${r.handle}:${r.i_follow}`} handle={r.handle} initial={r.i_follow} onChange={(on) => onFollow?.(r.handle, on)} />}
        </li>
      ))}
    </ul>
  );
}

/** Community's Traders tab: every public Kixo trader, searchable, with Follow. */
export function TradersTab({ onFollow }: { onFollow?: (handle: string, on: boolean) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"followers" | "new">("followers");
  const [rows, setRows] = useState<TraderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      getTraders(q.trim(), sort)
        .then((r) => alive && (setRows(r.traders), setErr(null)))
        .catch((e) => alive && setErr(e instanceof Error ? e.message : "Could not load"));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, sort]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 sm:max-w-xs">
          <Search size={14} strokeWidth={1.5} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search traders" aria-label="Search traders" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted" />
        </label>
        <div className="flex gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Sort">
          {(
            [
              ["followers", "Most followed"],
              ["new", "Newest"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={`h-8 rounded-md px-3 text-sm transition-colors ${sort === k ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <section className="rounded-xl border border-border bg-surface">
        {err ? (
          <p className="px-6 py-10 text-center text-sm text-muted">{/not set up/i.test(err) ? "Community opens soon" : err}</p>
        ) : !rows ? (
          <p className="px-6 py-10 text-center text-sm text-muted">Loading</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Users size={20} strokeWidth={1.5} className="text-muted" />
            <p className="text-sm text-text-2">{q.trim() ? `No trader matches "${q.trim()}"` : "No public traders yet. Make your profile and be the first"}</p>
          </div>
        ) : (
          <Rows rows={rows} onFollow={onFollow} />
        )}
      </section>
    </div>
  );
}

/** "12 followers" / "3 following" as buttons that open the list. */
export function FollowCounts({ handle, followers, following }: { handle: string; followers: number; following: number }) {
  const [open, setOpen] = useState<null | "followers" | "following">(null);
  return (
    <>
      <button type="button" onClick={() => setOpen("followers")} className="hover:text-text hover:underline">
        {followers} {followers === 1 ? "follower" : "followers"}
      </button>
      {" · "}
      <button type="button" onClick={() => setOpen("following")} className="hover:text-text hover:underline">
        {following} following
      </button>
      {open && createPortal(<PeopleDialog handle={handle} who={open} onClose={() => setOpen(null)} />, document.body)}
    </>
  );
}

function PeopleDialog({ handle, who, onClose }: { handle: string; who: "followers" | "following"; onClose: () => void }) {
  const [rows, setRows] = useState<TraderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getPeople(handle, who)
      .then((r) => setRows(r.people))
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load"));
  }, [handle, who]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={who === "followers" ? "Followers" : "Following"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface font-sans" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-medium text-text">
            {who === "followers" ? "Followers" : "Following"} · @{handle}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {err ? (
            <p className="px-6 py-10 text-center text-sm text-muted">{err}</p>
          ) : !rows ? (
            <p className="px-6 py-10 text-center text-sm text-muted">Loading</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted">{who === "followers" ? "No followers yet" : "Not following anyone yet"}</p>
          ) : (
            <Rows rows={rows} />
          )}
        </div>
      </div>
    </div>
  );
}
