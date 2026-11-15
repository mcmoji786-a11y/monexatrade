"use client";
import { useState } from "react";
import { HANDLE_RE, saveMe, type TraderProfile } from "@/lib/social";

/** Make or edit the trader profile: handle, name, bio, public or private. */
export function ProfileForm({ initial, onSaved }: { initial?: TraderProfile; onSaved: (p: TraderProfile) => void }) {
  const [handle, setHandle] = useState(initial?.handle ?? "");
  const [name, setName] = useState(initial?.display_name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [pub, setPub] = useState(initial?.public ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const h = handle.trim().replace(/^@/, "").toLowerCase();
  const ok = HANDLE_RE.test(h);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await saveMe({ handle: h, display_name: name, bio, public: pub });
      onSaved(r.profile);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-text-2">
        Handle
        <span className="flex h-10 items-center rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <span className="text-muted">@</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={21} placeholder="moonhunter" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none" />
        </span>
        {handle && !ok && <span className="text-warning">3 to 20 small letters, numbers or _</span>}
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-2">
        Name (optional)
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-emerald/50" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-2 sm:col-span-2">
        Bio (optional)
        <input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} placeholder="What you trade and how" className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-emerald/50" />
      </label>
      <label className="flex items-center gap-2 text-sm text-text-2 sm:col-span-2">
        <input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
        Public: others can see and copy my demo trades
      </label>
      {err && <p className="text-sm text-negative sm:col-span-2">{err}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={!ok || busy} className="h-10 rounded-lg bg-text px-5 text-sm font-medium text-bg transition-opacity disabled:opacity-50">
          {initial ? "Save" : "Create profile"}
        </button>
      </div>
    </form>
  );
}
