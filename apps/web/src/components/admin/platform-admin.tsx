"use client";

import { KixoMark } from "@/components/brand";
import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { adminFetch, OwnerNeeded, sendOwnerCode, signInAdmin, signOutAdmin, useAdminKey, useOwner, verifyOwnerCode } from "@/lib/admin";

const input = "h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50";
const primary = "flex h-9 items-center justify-center gap-1.5 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40";
const quiet = "flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ---------------- Sign-in ---------------- */

/** The admin opens only with the admin key (ADMIN_TOKEN). */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const key = useAdminKey();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (key) return <>{children}</>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-text">
      <form
        className="w-full max-w-[380px] rounded-2xl border border-border bg-surface p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await signInAdmin(value);
            setValue("");
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="flex items-center gap-2 font-medium">
          <KixoMark size={24} />
          Kixo Admin
        </p>
        <label htmlFor="admin-key" className="mt-6 block text-xs text-text-2">Admin key</label>
        <input id="admin-key" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} className={`${input} mt-2 font-mono`} />
        {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}
        <button type="submit" disabled={busy || value.trim().length < 16} className={`${primary} mt-4 w-full`}>
          {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
          Sign in
        </button>
        <p className="mt-4 text-[11px] leading-5 text-muted">The key is ADMIN_TOKEN from the gateway .env. It stays in this tab only. Money and API-key changes also need a code sent to the owner&apos;s email</p>
      </form>
    </div>
  );
}

export function AdminSignOut() {
  return (
    <button type="button" onClick={signOutAdmin} className="flex items-center gap-1.5 text-[11px] text-text-2 hover:text-text">
      <LogOut size={12} strokeWidth={1.5} />
      Sign out of the admin
    </button>
  );
}

/* ---------------- Owner code ---------------- */

/** Opens a 15-minute owner session with a code emailed to OWNER_EMAIL. */
export function OwnerUnlock({ compact = false }: { compact?: boolean }) {
  const active = useOwner();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (active)
    return (
      <p className="flex items-center gap-2 rounded-lg border border-positive/20 bg-positive/5 px-3 py-2 text-xs text-positive">
        <ShieldCheck size={14} strokeWidth={1.5} />
        Owner session open for 15 minutes: money and key changes are allowed
      </p>
    );
  return (
    <div className={`flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 ${compact ? "" : "max-w-xl"}`}>
      <p className="text-xs text-warning">Fees, limits, the fee wallet, real money switches and API keys need the owner code, sent to the owner&apos;s email</p>
      {!sentTo ? (
        <button
          type="button"
          disabled={busy}
          className={`${quiet} w-fit`}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setSentTo(await sendOwnerCode());
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <KeyRound size={14} strokeWidth={1.5} />}
          Email me the owner code
        </button>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await verifyOwnerCode(code);
              setCode("");
              setSentTo(null);
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label htmlFor="owner-code" className="text-[11px] text-text-2">Code sent to {sentTo}</label>
            <input id="owner-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className={`${input} mt-1 w-36 font-mono tracking-[0.3em] tabular-nums`} />
          </div>
          <button type="submit" disabled={busy || code.length !== 6} className={primary}>
            {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            Open owner session
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-negative">{error}</p>}
    </div>
  );
}

/* ---------------- Platform settings ---------------- */

type Config = {
  trade_fee_bps: number;
  deposit_fee_bps: number;
  withdraw_fee_bps: number;
  max_trade_sol: number;
  min_deposit_sol: number;
  max_deposit_sol: number;
  trading_allowlist: string[];
  fast_tip_lamports: number;
  turbo_tip_lamports: number;
  lower_risk_min_safety: number;
  lower_risk_hold_secs: number;
};
type KeyInfo = { name: string; label: string; source: "admin" | "env" | null; hint: string | null };
type AdminPlatform = { config: Config; keys: KeyInfo[]; owner_email: string | null; owner_session: boolean };

function usePlatformAdmin() {
  const [data, setData] = useState<AdminPlatform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    adminFetch<AdminPlatform>("/admin/platform")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void reload();
  }, []);
  return { data, error, reload, setData };
}

/** One number field with its unit and the range it accepts. */
function Field({ label, hint, value, unit, step, onChange }: { label: string; hint: string; value: number; unit: string; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-text-2">{label}</span>
      <span className="flex h-9 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
        <input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 bg-transparent font-mono text-sm tabular-nums text-text outline-none" />
        <span className="text-xs text-muted">{unit}</span>
      </span>
      <span className="text-[11px] text-muted">{hint}</span>
    </label>
  );
}

export function PlatformSettings() {
  const { data, error, setData } = usePlatformAdmin();
  const [edit, setDraft] = useState<Config | null>(null);
  const [allowEdit, setAllow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [needOwner, setNeedOwner] = useState(false);
  if (error) return <p className="text-sm text-negative">{error}</p>;
  if (!data) return <p className="text-sm text-text-2">Loading</p>;
  // Until the first edit, the form shows the saved values.
  const draft = edit ?? data.config;
  const allow = allowEdit ?? data.config.trading_allowlist.join("\n");
  const set = (p: Partial<Config>) => setDraft({ ...draft, ...p });
  const next: Config = { ...draft, trading_allowlist: allow.split(/[\s,]+/).filter(Boolean) };
  const changed = (Object.keys(next) as (keyof Config)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(data.config[k]));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminFetch<{ config: Config }>("/admin/platform", { method: "PUT", body: next });
      setData({ ...data!, config: r.config });
      setDraft(null);
      setAllow(null);
      setNeedOwner(false);
      setMsg({ ok: true, text: "Saved. Live for every visitor within 5 minutes, and at once for trades, deposits and withdrawals" });
    } catch (e) {
      if (e instanceof OwnerNeeded) setNeedOwner(true);
      else setMsg({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-6">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium">Fees</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Trade fee" hint="On every buy and sell. 0% to 3%" unit="%" step={0.05} value={draft.trade_fee_bps / 100} onChange={(v) => set({ trade_fee_bps: Math.round(v * 100) })} />
            <Field label="Deposit fee" hint="Free by default. 0% to 3%" unit="%" step={0.05} value={draft.deposit_fee_bps / 100} onChange={(v) => set({ deposit_fee_bps: Math.round(v * 100) })} />
            <Field label="Withdrawal fee" hint="On SOL leaving a Kixo wallet. 0% to 3%" unit="%" step={0.05} value={draft.withdraw_fee_bps / 100} onChange={(v) => set({ withdraw_fee_bps: Math.round(v * 100) })} />
          </div>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium">Limits</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Largest trade" hint="0.01 to 100 SOL" unit="SOL" step={0.5} value={draft.max_trade_sol} onChange={(v) => set({ max_trade_sol: v })} />
            <Field label="Smallest deposit" hint="0.001 to 10 SOL" unit="SOL" step={0.001} value={draft.min_deposit_sol} onChange={(v) => set({ min_deposit_sol: v })} />
            <Field label="Largest deposit" hint="Up to 10,000 SOL" unit="SOL" step={10} value={draft.max_deposit_sol} onChange={(v) => set({ max_deposit_sol: v })} />
          </div>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs text-text-2">Real trading allowlist</span>
            <textarea value={allow} onChange={(e) => setAllow(e.target.value)} rows={3} spellCheck={false} placeholder="Empty: everyone may trade. Otherwise one wallet address per line" className="rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50" />
            <span className="text-[11px] text-muted">For a soft launch: only these Kixo wallets can trade with real money</span>
          </label>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium">Sending speed</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Fast tip" hint="Paid by the user on Fast trades" unit="SOL" step={0.000001} value={draft.fast_tip_lamports / 1e9} onChange={(v) => set({ fast_tip_lamports: Math.round(v * 1e9) })} />
            <Field label="Turbo tip" hint="Paid by the user on Turbo trades" unit="SOL" step={0.0001} value={draft.turbo_tip_lamports / 1e9} onChange={(v) => set({ turbo_tip_lamports: Math.round(v * 1e9) })} />
          </div>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium">Sol Radar: Lower risk</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Minimum safety score" hint="50 to 100. A coin needs this score to be listed" unit="/100" step={1} value={draft.lower_risk_min_safety} onChange={(v) => set({ lower_risk_min_safety: Math.round(v) })} />
            <Field label="Stays listed for at least" hint="Up to 30 minutes. Danger checks still remove a coin at once" unit="sec" step={30} value={draft.lower_risk_hold_secs} onChange={(v) => set({ lower_risk_hold_secs: Math.round(v) })} />
          </div>
        </section>
      </div>
      <aside className="flex h-fit flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <h3 className="flex items-center justify-between text-sm font-medium">
          Your changes <span className="font-mono text-xs text-muted">{changed.length}</span>
        </h3>
        {changed.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">Change a value to see it here</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-xs">
            {changed.map((k) => (
              <li key={k} className="rounded-lg border border-border bg-bg/40 px-3 py-2 font-mono">
                <p className="font-sans text-text-2">{k.replace(/_/g, " ")}</p>
                <span className="text-negative line-through">{String(data.config[k])}</span>
                <span className="mx-2 text-muted">→</span>
                <span className="text-positive">{String(next[k])}</span>
              </li>
            ))}
          </ul>
        )}
        {needOwner && <OwnerUnlock compact />}
        <div className="flex gap-2">
          <button
            type="button"
            className={`${quiet} flex-1`}
            disabled={!changed.length}
            onClick={() => {
              setDraft(null);
              setAllow(null);
            }}
          >
            Discard
          </button>
          <button type="button" className={`${primary} flex-1`} disabled={!changed.length || busy} onClick={save}>
            {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            Save
          </button>
        </div>
        {msg && <p className={`text-xs ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
        <p className="text-[11px] leading-5 text-muted">Every change is saved in the audit log with its before and after. Ranges are checked on the server</p>
      </aside>
    </div>
  );
}

/* ---------------- API keys ---------------- */

export function ApiKeys() {
  const { data, error, reload } = usePlatformAdmin();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [needOwner, setNeedOwner] = useState(false);
  if (error) return <p className="text-sm text-negative">{error}</p>;
  if (!data) return <p className="text-sm text-text-2">Loading</p>;

  async function put(name: string, v: string) {
    setBusy(true);
    setMsg(null);
    try {
      await adminFetch("/admin/secrets", { method: "PUT", body: { name, value: v } });
      setEditing(null);
      setValue("");
      setNeedOwner(false);
      setMsg({ ok: true, text: v ? `${name} saved. It is used from now on` : `${name} cleared` });
      await reload();
    } catch (e) {
      if (e instanceof OwnerNeeded) setNeedOwner(true);
      else setMsg({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {needOwner && <OwnerUnlock />}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {data.keys.map((k, i) => (
          <div key={k.name} className={`flex flex-col gap-2 px-5 py-4 ${i ? "border-t border-border" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm">{k.name}</p>
                <p className="text-xs text-text-2">{k.label}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`flex items-center gap-1.5 text-xs ${k.source ? "text-positive" : "text-muted"}`}>
                  {k.source ? <Check size={12} strokeWidth={1.5} /> : null}
                  {k.source ? `Set ${k.hint ?? ""} · ${k.source === "admin" ? "from admin" : "from .env"}` : "Not set"}
                </span>
                <button type="button" className={quiet} onClick={() => (setEditing(editing === k.name ? null : k.name), setValue(""))}>
                  {k.source ? "Replace" : "Set"}
                </button>
                {k.source === "admin" && (
                  <button type="button" className={quiet} disabled={busy} onClick={() => put(k.name, "")}>
                    Clear
                  </button>
                )}
              </div>
            </div>
            {editing === k.name && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void put(k.name, value);
                }}
              >
                <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste the key" className={`${input} font-mono`} />
                <button type="submit" disabled={busy || !value.trim()} className={primary}>
                  {busy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
                  Save
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
      <p className="text-[11px] leading-5 text-muted">
        Keys are stored on the server only and are never shown again, only their last 4 characters. A key set here wins over the .env one; Clear goes back to .env. The Helius live stream picks up a new key on the next restart; everything else uses it at once
      </p>
    </div>
  );
}

/* ---------------- Audit log ---------------- */

type AuditRow = { ts: number; ip: string | null; action: string; detail: Record<string, unknown> };

const ACTIONS: Record<string, string> = {
  platform_settings: "Platform settings",
  api_key: "API key",
  features: "Features",
  rewards: "Rewards",
  owner_session_opened: "Owner session opened",
  owner_code_failed: "Wrong owner code",
};

export function AuditLog() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminFetch<AuditRow[]>("/admin/audit?limit=300")
      .then(setRows)
      .catch((e) => setError(message(e)));
  }, []);
  if (error) return <p className="text-sm text-negative">{error}</p>;
  if (!rows) return <p className="text-sm text-text-2">Loading</p>;
  if (!rows.length) return <p className="rounded-xl border border-border bg-surface px-5 py-8 text-center text-sm text-text-2">No changes yet. Every admin change will appear here</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-border text-muted">
          <tr>
            <th className="px-4 py-2 font-normal">When</th>
            <th className="px-4 py-2 font-normal">What</th>
            <th className="px-4 py-2 font-normal">Change</th>
            <th className="px-4 py-2 font-normal">From</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              <td className="whitespace-nowrap px-4 py-2 font-mono tabular-nums text-text-2">{new Date(r.ts * 1000).toLocaleString()}</td>
              <td className="px-4 py-2 text-text">{ACTIONS[r.action] ?? r.action}</td>
              <td className="px-4 py-2 font-mono text-text-2">
                {Object.entries(r.detail).length === 0
                  ? "—"
                  : Object.entries(r.detail).map(([k, v]) => (
                      <p key={k}>
                        <span className="text-muted">{k}</span> {Array.isArray(v) && v.length === 2 ? `${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}` : JSON.stringify(v)}
                      </p>
                    ))}
              </td>
              <td className="px-4 py-2 font-mono text-muted">{r.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
