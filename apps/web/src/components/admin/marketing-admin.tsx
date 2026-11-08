"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { adminFetch, OwnerNeeded } from "@/lib/admin";
import type { Message, Site } from "@/lib/marketing";
import { OwnerUnlock } from "./platform-admin";

const input = "h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50";
const primary = "flex h-9 items-center justify-center gap-1.5 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40";
const quiet = "flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Funnel = { signups: number; wallets: number; depositors: number; traders: number; visits?: number };
type Campaign = { code: string; name: string; created: number; visits: number };
type Promo = { code: string; applies: string; discount_pct: number; expires: number; max_uses: number; uses: number; active: boolean };
type Marketing = { campaigns: Campaign[]; promos: Promo[]; banner: Message; popup: Message; site: Site };
type Reply = { marketing: Marketing; funnel: Funnel; campaigns: { campaign: Campaign; funnel: Funnel }[] };

const TABS = [
  ["links", "Tracking links"],
  ["promos", "Promo codes"],
  ["messages", "Banner and popup"],
  ["site", "Social and search"],
] as const;

export function MarketingAdmin() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("links");
  const [data, setData] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    adminFetch<Reply>("/admin/marketing")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void reload();
  }, []);
  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" className="flex w-fit gap-1 rounded-lg border border-border p-1">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`h-8 rounded-md px-3 text-sm transition-colors ${tab === k ? "bg-surface-2 text-text" : "text-text-2 hover:text-text"}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
      {!data ? (
        <p className="text-sm text-text-2">Loading</p>
      ) : tab === "links" ? (
        <Links data={data} reload={reload} />
      ) : tab === "promos" ? (
        <Promos promos={data.marketing.promos} reload={reload} />
      ) : (
        <Messages m={data.marketing} which={tab} reload={reload} />
      )}
    </div>
  );
}

/* ---------------- Tracking links and funnel ---------------- */

function Step({ label, n, of }: { label: string; n: number; of: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-text-2">{label}</p>
      <p className="mt-2 font-mono text-2xl tabular-nums">{n.toLocaleString()}</p>
      <p className="mt-1 text-[11px] text-muted">{of ? `${Math.round((n / of) * 100)}% of the step before` : " "}</p>
    </div>
  );
}

function Links({ data, reload }: { data: Reply; reload: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const f = data.funnel;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-medium">All sign-ups</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Step label="Signed up" n={f.signups} of={null} />
          <Step label="Set up a Kixo wallet" n={f.wallets} of={f.signups} />
          <Step label="Deposited" n={f.depositors} of={f.wallets} />
          <Step label="Traded with real SOL" n={f.traders} of={f.depositors} />
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-normal">Link</th>
              <th className="px-4 py-2 text-right font-normal">Visits</th>
              <th className="px-4 py-2 text-right font-normal">Sign-ups</th>
              <th className="px-4 py-2 text-right font-normal">Wallets</th>
              <th className="px-4 py-2 text-right font-normal">Deposited</th>
              <th className="px-4 py-2 text-right font-normal">Traded</th>
              <th className="px-4 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {data.campaigns.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-xs text-text-2">No tracking links yet. Make one for each place you post: X, Telegram, a YouTube video, a creator</td>
              </tr>
            ) : (
              data.campaigns.map(({ campaign: c, funnel: cf }) => {
                const url = `${origin}/?c=${c.code}`;
                return (
                  <tr key={c.code} className="border-t border-border">
                    <td className="px-4 py-2">
                      <p className="text-text">{c.name || c.code}</p>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(url).then(() => (setCopied(c.code), setTimeout(() => setCopied(null), 1500)))}
                        className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-cyan hover:text-text"
                      >
                        {url.replace(/^https?:\/\//, "")}
                        {copied === c.code ? <Check size={11} strokeWidth={1.5} /> : <Copy size={11} strokeWidth={1.5} />}
                      </button>
                    </td>
                    {[cf.visits ?? 0, cf.signups, cf.wallets, cf.depositors, cf.traders].map((n, i) => (
                      <td key={i} className="px-4 py-2 text-right font-mono tabular-nums">{n}</td>
                    ))}
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Delete ${c.code}`}
                        onClick={async () => {
                          if (!confirm(`Delete the link ${c.code}? Its numbers are lost`)) return;
                          await adminFetch(`/admin/campaigns/${c.code}`, { method: "DELETE" }).catch(() => {});
                          await reload();
                        }}
                        className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-negative"
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await adminFetch("/admin/campaigns", { body: { code, name } });
            setCode("");
            setName("");
            await reload();
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-text-2">Code in the link</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20))} placeholder="x-launch" className={`${input} w-44 font-mono`} />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <span className="text-xs text-text-2">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Launch post on X" className={input} />
        </label>
        <button type="submit" disabled={busy || code.length < 3} className={primary}>
          {busy ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <Plus size={14} strokeWidth={1.5} />}
          Make link
        </button>
        {error && <p className="w-full text-xs text-negative">{error}</p>}
      </form>
      <p className="text-[11px] leading-5 text-muted">A visit counts once per visitor per day. A sign-up counts for the first link the person came from in the 30 days before signing up</p>
    </div>
  );
}

/* ---------------- Promo codes ---------------- */

const toTs = (d: string) => (d ? Math.floor(new Date(d).getTime() / 1000) : 0);

function Promos({ promos, reload }: { promos: Promo[]; reload: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [applies, setApplies] = useState("both");
  const [pct, setPct] = useState(50);
  const [ends, setEnds] = useState("");
  const [max, setMax] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needOwner, setNeedOwner] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-normal">Code</th>
              <th className="px-4 py-2 font-normal">Lowers</th>
              <th className="px-4 py-2 text-right font-normal">Off Kixo&apos;s fee</th>
              <th className="px-4 py-2 text-right font-normal">Used</th>
              <th className="px-4 py-2 font-normal">Ends</th>
              <th className="px-4 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {promos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-text-2">No promo codes yet</td>
              </tr>
            ) : (
              promos.map((p) => (
                <tr key={p.code} className={`border-t border-border ${p.active ? "" : "opacity-50"}`}>
                  <td className="px-4 py-2 font-mono">{p.code}</td>
                  <td className="px-4 py-2 text-text-2">{p.applies === "both" ? "Trades and transfers" : p.applies === "trade" ? "Trades" : "Deposits and withdrawals"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{p.discount_pct}%</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {p.uses}
                    {p.max_uses ? ` / ${p.max_uses}` : ""}
                  </td>
                  <td className="px-4 py-2 text-text-2">{!p.active ? "Ended" : p.expires ? new Date(p.expires * 1000).toLocaleDateString() : "No end date"}</td>
                  <td className="px-4 py-2 text-right">
                    {p.active && (
                      <button
                        type="button"
                        className={quiet}
                        onClick={async () => {
                          if (!confirm(`End ${p.code}? Everyone using it goes back to normal fees`)) return;
                          await adminFetch(`/admin/promos/${p.code}/end`, { body: {} }).catch(() => {});
                          await reload();
                        }}
                      >
                        End
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <form
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await adminFetch("/admin/promos", { body: { code, applies, discount_pct: pct, expires: toTs(ends), max_uses: max } });
            setCode("");
            setNeedOwner(false);
            await reload();
          } catch (err) {
            if (err instanceof OwnerNeeded) setNeedOwner(true);
            else setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 className="text-sm font-medium">New promo code</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-text-2">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20))} placeholder="LAUNCH50" className={`${input} font-mono`} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-text-2">Lowers</span>
            <select value={applies} onChange={(e) => setApplies(e.target.value)} className={input}>
              <option value="both">Trades and transfers</option>
              <option value="trade">Trade fee</option>
              <option value="transfer">Deposit and withdrawal fee</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-text-2">Off Kixo&apos;s fee</span>
            <span className="flex h-9 items-center gap-2 rounded-lg border border-border bg-bg px-3">
              <input type="number" min={1} max={100} value={pct} onChange={(e) => setPct(Math.max(1, Math.min(100, Math.round(Number(e.target.value)))))} className="min-w-0 flex-1 bg-transparent font-mono text-sm tabular-nums outline-none" />
              <span className="text-xs text-muted">%</span>
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-text-2">Ends (optional)</span>
            <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-text-2">Most uses (0 = no limit)</span>
            <input type="number" min={0} value={max} onChange={(e) => setMax(Math.max(0, Math.round(Number(e.target.value))))} className={`${input} font-mono tabular-nums`} />
          </label>
        </div>
        {needOwner && <OwnerUnlock compact />}
        {error && <p className="text-xs text-negative">{error}</p>}
        <button type="submit" disabled={busy || code.length < 3} className={`${primary} w-fit`}>
          {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
          Create code
        </button>
        <p className="text-[11px] leading-5 text-muted">A code lowers Kixo&apos;s own fee only, never the network or pool fees. Users enter it under their wallet balance. Creating a code needs the owner code</p>
      </form>
    </div>
  );
}

/* ---------------- Banner, popup, social and search ---------------- */

const toLocal = (ts: number) => (ts ? new Date(ts * 1000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");

function MessageEditor({ label, hint, m, onChange }: { label: string; hint: string; m: Message; onChange: (m: Message) => void }) {
  const set = (p: Partial<Message>) => onChange({ ...m, ...p });
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-sm font-medium">{label}</span>
          <span className="block text-xs text-text-2">{hint}</span>
        </span>
        <input type="checkbox" checked={m.on} onChange={(e) => set({ on: e.target.checked })} className="h-4 w-4 accent-emerald" />
      </label>
      <input value={m.title} onChange={(e) => set({ title: e.target.value.slice(0, 80) })} placeholder="Title (optional)" className={input} />
      <textarea value={m.text} onChange={(e) => set({ text: e.target.value.slice(0, 300) })} rows={2} placeholder="Text" className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-emerald/50" />
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={m.link} onChange={(e) => set({ link: e.target.value.trim().slice(0, 300) })} placeholder="Link: /competition or https://…" className={`${input} font-mono text-xs`} />
        <input value={m.link_label} onChange={(e) => set({ link_label: e.target.value.slice(0, 30) })} placeholder="Button text" className={input} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-text-2">Starts</span>
          <input type="datetime-local" value={toLocal(m.starts)} onChange={(e) => set({ starts: toTs(e.target.value) })} className={input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-text-2">Ends</span>
          <input type="datetime-local" value={toLocal(m.ends)} onChange={(e) => set({ ends: toTs(e.target.value) })} className={input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-text-2">Who sees it</span>
          <select value={m.audience || "all"} onChange={(e) => set({ audience: e.target.value as Message["audience"] })} className={input}>
            <option value="all">Everyone</option>
            <option value="signed_out">Visitors not signed in</option>
            <option value="signed_in">Signed-in users</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function Messages({ m, which, reload }: { m: Marketing; which: "messages" | "site"; reload: () => Promise<void> }) {
  const [banner, setBanner] = useState(m.banner);
  const [popup, setPopup] = useState(m.popup);
  const [site, setSite] = useState(m.site);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const setS = (p: Partial<Site>) => setSite({ ...site, ...p });
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await adminFetch("/admin/marketing", { method: "PUT", body: { banner, popup, site } });
      setMsg({ ok: true, text: "Saved. Visitors see it within 5 minutes" });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {which === "messages" ? (
        <>
          <MessageEditor label="Banner" hint="A line above every page" m={banner} onChange={setBanner} />
          <MessageEditor label="Popup" hint="Shown once to each visitor; editing it shows it again. Use it for broadcasts to all users" m={popup} onChange={setPopup} />
        </>
      ) : (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium">Social links</h3>
          <p className="text-xs text-text-2">Shown in the site footer. Leave empty to hide one</p>
          {(
            [
              ["x", "X", "https://x.com/kixo"],
              ["telegram", "Telegram", "https://t.me/kixo"],
              ["discord", "Discord", "https://discord.gg/…"],
              ["youtube", "YouTube", "https://youtube.com/@kixo"],
            ] as const
          ).map(([k, label, ph]) => (
            <label key={k} className="grid grid-cols-[96px_1fr] items-center gap-3">
              <span className="text-xs text-text-2">{label}</span>
              <input value={site[k]} onChange={(e) => setS({ [k]: e.target.value.trim().slice(0, 200) } as Partial<Site>)} placeholder={ph} className={`${input} font-mono text-xs`} />
            </label>
          ))}
          <h3 className="mt-3 text-sm font-medium">Search results</h3>
          <p className="text-xs text-text-2">How Kixo appears on Google and in link previews. Empty uses the built-in text</p>
          <input value={site.seo_title} onChange={(e) => setS({ seo_title: e.target.value.slice(0, 70) })} placeholder="Kixo – AI-Powered Solana Memecoin Trading Terminal" className={input} />
          <textarea value={site.seo_description} onChange={(e) => setS({ seo_description: e.target.value.slice(0, 200) })} rows={2} placeholder="Description, up to 200 characters" className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-emerald/50" />
        </section>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={primary}>
          {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
          Save
        </button>
        {msg && <p className={`text-xs ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
