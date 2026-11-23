"use client";
import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { HANDLE_RE, saveMe, type TraderProfile } from "@/lib/social";
import { uploadProfileImage } from "@/lib/profile-media";
import { TraderAvatar } from "./social-bits";

/** Make or edit the trader profile: picture, banner, handle, name, bio, links, and
 *  whether it is public. */
export function ProfileForm({ initial, onSaved }: { initial?: TraderProfile; onSaved: (p: TraderProfile) => void }) {
  const [handle, setHandle] = useState(initial?.handle ?? "");
  const [name, setName] = useState(initial?.display_name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [pub, setPub] = useState(initial?.public ?? true);
  const [avatar, setAvatar] = useState(initial?.avatar_url ?? "");
  const [banner, setBanner] = useState(initial?.banner_url ?? "");
  const [x, setX] = useState(initial?.x_handle ?? "");
  const [tg, setTg] = useState(initial?.telegram ?? "");
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const h = handle.trim().replace(/^@/, "").toLowerCase();
  const ok = HANDLE_RE.test(h);

  const pick = async (kind: "avatar" | "banner", file: File | undefined) => {
    if (!file) return;
    setUploading(kind);
    setErr(null);
    try {
      const url = await uploadProfileImage(kind, file);
      if (kind === "avatar") setAvatar(url);
      else setBanner(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not upload");
    } finally {
      setUploading(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy || uploading) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await saveMe({ handle: h, display_name: name, bio, public: pub, avatar_url: avatar, banner_url: banner, x_handle: x.trim().replace(/^@/, ""), telegram: tg.trim().replace(/^@/, "") });
      onSaved(r.profile);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const input = "h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none focus:border-emerald/50";
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {/* Banner and picture, as they look on the profile */}
      <div className="relative">
        <button
          type="button"
          onClick={() => bannerInput.current?.click()}
          className="group relative block aspect-[3/1] max-h-40 w-full overflow-hidden rounded-xl border border-border bg-surface-2"
          aria-label="Change banner"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {banner && <img src={banner} alt="" className="h-full w-full object-cover" />}
          <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 text-sm text-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {uploading === "banner" ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin" /> : <ImagePlus size={16} strokeWidth={1.5} />}
            {banner ? "Change banner" : "Add a banner (1500 × 500)"}
          </span>
          {!banner && uploading !== "banner" && <span className="absolute inset-0 flex items-center justify-center text-xs text-muted group-hover:opacity-0">Add a banner</span>}
        </button>
        <button type="button" onClick={() => avatarInput.current?.click()} className="group absolute -bottom-8 left-4 rounded-full ring-4 ring-surface" aria-label="Change picture">
          <TraderAvatar handle={h || "?"} src={avatar} size={72} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {uploading === "avatar" ? <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-text" /> : <Camera size={16} strokeWidth={1.5} className="text-text" />}
          </span>
        </button>
        <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void pick("banner", e.target.files?.[0])} />
        <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void pick("avatar", e.target.files?.[0])} />
      </div>
      <div className="flex justify-end gap-3 text-xs">
        {avatar && (
          <button type="button" onClick={() => setAvatar("")} className="text-text-2 hover:text-text">
            Remove picture
          </button>
        )}
        {banner && (
          <button type="button" onClick={() => setBanner("")} className="text-text-2 hover:text-text">
            Remove banner
          </button>
        )}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Handle
          <span className="flex h-10 items-center rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
            <span className="text-muted">@</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={21} placeholder="moonhunter" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none" />
          </span>
          {handle && !ok && <span className="text-warning">3 to 20 small letters, numbers or _</span>}
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2 sm:col-span-2">
          Bio
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} rows={2} placeholder="What you trade and how" className="resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-emerald/50" />
          <span className="self-end font-mono text-muted">{bio.length}/160</span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2">
          X
          <span className="flex h-10 items-center rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
            <span className="text-muted">x.com/</span>
            <input value={x} onChange={(e) => setX(e.target.value)} maxLength={16} placeholder="handle" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none" />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Telegram
          <span className="flex h-10 items-center rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
            <span className="text-muted">t.me/</span>
            <input value={tg} onChange={(e) => setTg(e.target.value)} maxLength={33} placeholder="username" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none" />
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-text-2 sm:col-span-2">
          <input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
          Public: others can see my profile, results and demo trades, and copy them
        </label>
      </div>
      {err && <p className="text-sm text-negative">{err}</p>}
      <div>
        <button type="submit" disabled={!ok || busy || !!uploading} className="h-10 rounded-lg bg-text px-5 text-sm font-medium text-bg transition-opacity disabled:opacity-50">
          {busy ? "Saving" : initial ? "Save profile" : "Create profile"}
        </button>
      </div>
    </form>
  );
}
