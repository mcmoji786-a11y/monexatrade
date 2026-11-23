"use client";
/* The Kixo Creator Program (kixo.trade/creators): the live share from the admin's rewards
   settings, and the application form, which waits for the Kixo team on the admin page.
   Moved here from Rewards so anyone can find it without an account. */
import { useEffect, useState } from "react";
import { CircleCheck, Plus, Trash2 } from "lucide-react";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { FALLBACK_CONFIG, PLATFORMS, type RewardsConfig } from "@/lib/rewards";

/** Rewards settings from the gateway; the built-in draft while it is unreachable. */
export function useRewardsConfig() {
  const [cfg, setCfg] = useState<RewardsConfig>(FALLBACK_CONFIG);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/rewards/config`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: RewardsConfig | null) => c && setCfg(c))
      .catch(() => {});
  }, []);
  return cfg;
}

/** The creator share as the admin set it, for the page's headline. */
export function CreatorShare() {
  const cfg = useRewardsConfig();
  return <>{cfg.creator_max_share_pct}%</>;
}

const VOLUMES = [10_000, 100_000, 1_000_000];
const money = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;

/** A worked example of the share, from the admin's fee and creator share: the monthly
 *  trading volume of an audience, the fees it pays, and the creator's part. */
export function EarningsExample() {
  const cfg = useRewardsConfig();
  const [vol, setVol] = useState(VOLUMES[1]);
  const fees = (vol * cfg.trading_fee_pct) / 100;
  const yours = (fees * cfg.creator_max_share_pct) / 100;
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <p className="text-xs text-muted">Example</p>
      <p className="mt-1 text-base text-text">If your audience trades this much in a month</p>
      <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Monthly volume">
        {VOLUMES.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={vol === v}
            onClick={() => setVol(v)}
            className={`h-10 rounded-lg border font-mono text-sm transition-colors ${vol === v ? "border-emerald/40 bg-surface-2 text-text" : "border-border text-text-2 hover:text-text"}`}
          >
            {v >= 1_000_000 ? `$${v / 1_000_000}M` : `$${v / 1000}K`}
          </button>
        ))}
      </div>
      <dl className="mt-6 flex flex-col gap-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-2">Fees they pay ({cfg.trading_fee_pct}% per trade)</dt>
          <dd className="font-mono text-text">{money(fees)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-3">
          <dt className="text-text">You earn ({cfg.creator_max_share_pct}%)</dt>
          <dd className="font-mono text-lg text-emerald">{money(yours)} a month</dd>
        </div>
      </dl>
      <p className="mt-4 text-[11px] leading-5 text-muted">An illustration of the math, not a promise. Your real share is confirmed when you are approved</p>
    </div>
  );
}

type SocialRow = { platform: string; url: string };

/** Creator application: name, one or more social accounts, audience, contact and a note.
 *  Sent to the gateway, where it waits for the admin. */
export function CreatorApply() {
  const cfg = useRewardsConfig();
  const open = cfg.creator_open;
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [socials, setSocials] = useState<SocialRow[]>([{ platform: "x", url: "" }]);
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" | "error"; msg?: string }>({ kind: "idle" });

  const used = new Set(socials.map((s) => s.platform));
  const setRow = (i: number, patch: Partial<SocialRow>) => setSocials((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const valid = name.trim().length > 0 && contact.trim().length > 0 && socials.some((s) => s.url.trim()) && socials.every((s) => !s.url.trim() || /^https:\/\/\S+\.\S+/.test(s.url.trim()));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const res = await fetch(`${GATEWAY_HTTP}/creator/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          audience: audience.trim(),
          contact: contact.trim(),
          note: note.trim(),
          socials: socials.filter((s) => s.url.trim()).map((s) => ({ platform: s.platform, url: s.url.trim() })),
        }),
      });
      if (res.ok) setState({ kind: "sent" });
      else setState({ kind: "error", msg: (await res.text()) || "Could not send. Try again" });
    } catch {
      setState({ kind: "error", msg: "Kixo is offline. Try again in a moment" });
    }
  };

  if (state.kind === "sent") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-6 py-12 text-center">
        <CircleCheck size={32} strokeWidth={1.5} className="text-positive" />
        <p className="text-base font-medium text-text">Application sent</p>
        <p className="max-w-xs text-sm text-text-2">The Kixo team reviews every request and replies on the contact you gave, usually within two days</p>
      </div>
    );
  }

  const field = "h-10 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50";
  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-surface p-5 md:p-6">
      <p className="text-base font-medium text-text">Apply to the Creator Program</p>
      <p className="mt-1 text-sm text-text-2">Takes two minutes. No minimum follower count</p>
      {!open && <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">Applications are closed for now. Check back soon</p>}
      <fieldset disabled={!open} className="mt-5 flex flex-col gap-4 disabled:opacity-50">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Name or handle
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="@yourname" className={field} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Where you post</span>
          {socials.map((row, i) => {
            const meta = PLATFORMS.find((p) => p.key === row.platform)!;
            return (
              <div key={i} className="flex gap-1.5">
                <select value={row.platform} onChange={(e) => setRow(i, { platform: e.target.value })} aria-label="Platform" className="h-10 w-32 shrink-0 rounded-lg border border-border bg-bg px-2 text-sm text-text outline-none focus:border-emerald/50">
                  {PLATFORMS.filter((p) => p.key === row.platform || !used.has(p.key)).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input value={row.url} onChange={(e) => setRow(i, { url: e.target.value })} placeholder={`${meta.prefix}…`} spellCheck={false} aria-label={`${meta.label} link`} className={`${field} min-w-0 flex-1 font-mono text-xs placeholder:font-sans`} />
                {socials.length > 1 && (
                  <button type="button" onClick={() => setSocials((r) => r.filter((_, k) => k !== i))} aria-label="Remove" className="px-1 text-muted hover:text-negative">
                    <Trash2 size={15} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            );
          })}
          {socials.length < PLATFORMS.length && (
            <button
              type="button"
              onClick={() => setSocials((r) => [...r, { platform: PLATFORMS.find((p) => !used.has(p.key))!.key, url: "" }])}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs text-text-2 hover:text-text"
            >
              <Plus size={14} strokeWidth={1.5} />
              Add another platform
            </button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Audience size
            <input value={audience} onChange={(e) => setAudience(e.target.value.slice(0, 40))} placeholder="12K followers" className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Contact for our reply
            <input value={contact} onChange={(e) => setContact(e.target.value.slice(0, 100))} placeholder="@telegram or email" className={field} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          About your content (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 600))} rows={3} placeholder="What you post, how often, who follows you" className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50" />
        </label>

        {state.kind === "error" && <p className="text-xs text-negative">{state.msg}</p>}
        <button type="submit" disabled={!valid || state.kind === "sending"} className="h-11 rounded-lg bg-text text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40">
          {state.kind === "sending" ? "Sending" : "Send application"}
        </button>
        <p className="text-[11px] text-muted">Links start with https://. Your request goes to the Kixo team only</p>
      </fieldset>
    </form>
  );
}
