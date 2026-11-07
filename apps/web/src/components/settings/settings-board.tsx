"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, LogOut, TriangleAlert } from "lucide-react";
import { signOut, signOutEverywhere, useAccount } from "@/lib/account";
import { refLink, useReferral } from "@/lib/growth";
import { resetDemo } from "@/lib/demo";
import { deleteMyAccount, downloadMyData, updateSettings, useSettings, type Settings } from "@/lib/settings";
import { pushToast } from "@/lib/toast";

const SECTIONS = [
  { id: "trading", label: "Trading" },
  { id: "demo", label: "Demo account" },
  { id: "notifications", label: "Notifications" },
  { id: "account", label: "Account" },
  { id: "data", label: "Data and privacy" },
  { id: "shortcuts", label: "Shortcuts" },
] as const;

const SLIPPAGE = [100, 500, 1000, 2000];

/** Settings: trading defaults and presets, demo, notifications, account, data. Saved to
 *  the account, so they apply on every device. */
export function SettingsBoard() {
  const { settings: s, loaded, save } = useSettings();
  const t = s.trading;
  const up = (f: (s: Settings) => Settings) => updateSettings(f);
  const trading = (p: Partial<Settings["trading"]>) => up((x) => ({ ...x, trading: { ...x.trading, ...p } }));
  const notes = (p: Partial<Settings["notifications"]>) => up((x) => ({ ...x, notifications: { ...x.notifications, ...p } }));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-text">Settings</h1>
          <p className="mt-1 text-sm text-text-2">Saved to your account, so they apply on every device you sign in on</p>
        </div>
        <SaveBadge state={save} loaded={loaded} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-20 flex flex-col gap-0.5">
            {SECTIONS.map((x) => (
              <li key={x.id}>
                <a href={`#${x.id}`} className="flex h-8 items-center rounded-md px-3 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
                  {x.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <Card id="trading" title="Trading" sub="Defaults for real trades. Each ticket can still change them for that trade">
            <Row label="Slippage" hint="How far the price may move before a trade is refused instead of filled">
              <Segmented value={t.slippage_bps} options={[...new Set([...SLIPPAGE, t.slippage_bps])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${v / 100}%` }))} onChange={(v) => trading({ slippage_bps: v })} />
            </Row>
            <Row label="Speed" hint={t.speed === "turbo" ? "Every fast path, 0.001 SOL tip, priority fee up to 0.003 SOL" : "Staked connections only, 0.000005 SOL tip, priority fee up to 0.001 SOL"}>
              <Segmented value={t.speed} options={[{ value: "fast", label: "Fast" }, { value: "turbo", label: "Turbo" }]} onChange={(v) => trading({ speed: v })} />
            </Row>
            <Row label="MEV protection" hint="Avoids validators known for sandwich attacks">
              <Switch on={t.mev} onChange={(v) => trading({ mev: v })} label="MEV protection" />
            </Row>
            <Row label="Buy buttons" hint="Up to five amounts in SOL, at most 3 SOL each">
              <Presets values={t.buy_presets} unit="SOL" max={5} step={0.01} onChange={(v) => trading({ buy_presets: v })} />
            </Row>
            <Row label="Sell buttons" hint="Up to four shares of the position">
              <Presets values={t.sell_presets} unit="%" max={4} step={1} onChange={(v) => trading({ sell_presets: v })} />
            </Row>
            <Row label="Confirm large buys" hint={t.confirm_above_sol > 0 ? `Buys of ${t.confirm_above_sol} SOL or more need a second click` : "Never asks twice"}>
              <Segmented value={t.confirm_above_sol} options={[0, 0.5, 1, 2].map((v) => ({ value: v, label: v === 0 ? "Off" : `${v} SOL` }))} onChange={(v) => trading({ confirm_above_sol: v })} />
            </Row>
          </Card>

          <Card id="demo" title="Demo account" sub="Virtual money traded at live prices">
            <Row label="Buy buttons" hint="Up to four amounts in USD">
              <Presets values={s.demo.buy_presets_usd} unit="$" max={4} step={1} prefix onChange={(v) => up((x) => ({ ...x, demo: { buy_presets_usd: v } }))} />
            </Row>
            <Row label="After signing in, open" hint="Which account the app starts in">
              <Segmented value={s.general.start_mode} options={[{ value: "last", label: "Last used" }, { value: "demo", label: "Demo" }, { value: "real", label: "Real" }]} onChange={(v) => up((x) => ({ ...x, general: { start_mode: v } }))} />
            </Row>
            <Row label="Start over" hint="Back to $10,000. Past trades stay in your history">
              <ResetDemo />
            </Row>
          </Card>

          <Card id="notifications" title="Notifications" sub="Pop-ups at the bottom right while Kixo is open">
            <Row label="Filled trades" hint="Demo and real buys and sells">
              <Switch on={s.notifications.trades} onChange={(v) => notes({ trades: v })} label="Filled trades" />
            </Row>
            <Row label="Take profit and stop loss" hint="When an exit order sells">
              <Switch on={s.notifications.exits} onChange={(v) => notes({ exits: v })} label="Take profit and stop loss" />
            </Row>
            <Row label="Paper sniper" hint="Entries and exits of the sniper">
              <Switch on={s.notifications.sniper} onChange={(v) => notes({ sniper: v })} label="Paper sniper" />
            </Row>
            <Row label="Sound" hint="A short tone with trade and exit pop-ups">
              <Switch on={s.notifications.sound} onChange={(v) => notes({ sound: v })} label="Sound" />
            </Row>
            <Row label="Desktop notifications" hint="Used by price alerts, Wallet Monitor and the sniper when this tab is in the background">
              <DesktopPermission />
            </Row>
            <Row label="Telegram" hint="Alerts on your phone">
              <span className="rounded border border-border px-2 py-0.5 text-xs text-muted">Soon</span>
            </Row>
          </Card>

          <AccountCard />
          <DataCard />

          <Card id="shortcuts" title="Shortcuts" sub="Anywhere in the app, except while typing">
            {[
              ["/", "Search a token or contract address"],
              ["[", "Collapse or expand the sidebar"],
              ["Enter", "Place the order in a ticket"],
              ["Esc", "Close a dialog"],
            ].map(([k, v]) => (
              <Row key={k} label={v}>
                <kbd className="rounded border border-border bg-bg px-2 py-0.5 font-mono text-xs text-text-2">{k}</kbd>
              </Row>
            ))}
          </Card>
        </div>
      </div>
    </section>
  );
}

function SaveBadge({ state, loaded }: { state: string; loaded: boolean }) {
  const text = !loaded ? "Loading" : state === "saving" ? "Saving" : state === "error" ? "Not saved. Change it again to retry" : state === "saved" ? "Saved" : "Up to date";
  return (
    <span className={`flex items-center gap-1.5 text-xs ${state === "error" ? "text-negative" : "text-muted"}`} role="status">
      {state === "saving" || !loaded ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : state === "error" ? <TriangleAlert size={14} strokeWidth={1.5} /> : <Check size={14} strokeWidth={1.5} className="text-emerald" />}
      {text}
    </span>
  );
}

function Card({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-medium text-text">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-text-2">{sub}</p>}
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm text-text">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-border bg-bg p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-md px-3 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${o.value === value ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-emerald ${on ? "border-emerald/50 bg-emerald/80" : "border-border bg-surface-3"}`}
    >
      <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

/** Editable preset amounts; changes save when a field loses focus. */
function Presets({ values, unit, max, step, prefix, onChange }: { values: number[]; unit: string; max: number; step: number; prefix?: boolean; onChange: (v: number[]) => void }) {
  const [draft, setDraft] = useState<{ src: number[]; text: string[] }>({ src: values, text: values.map(String) });
  const text = draft.src === values ? draft.text : values.map(String);
  const commit = (next: string[]) => {
    const nums = next.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length) onChange(nums);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {text.map((v, i) => (
        <label key={i} className="flex h-8 items-center gap-1 rounded-md border border-border bg-bg px-2 focus-within:border-emerald/50">
          {prefix && <span className="font-mono text-xs text-muted">{unit}</span>}
          <input
            inputMode="decimal"
            value={v}
            step={step}
            aria-label={`Preset ${i + 1}`}
            onChange={(e) => {
              const t = [...text];
              t[i] = e.target.value.replace(/[^0-9.]/g, "");
              setDraft({ src: values, text: t });
            }}
            onBlur={() => commit(text)}
            className="w-12 bg-transparent text-right font-mono text-xs text-text outline-none"
          />
          {!prefix && <span className="font-mono text-xs text-muted">{unit}</span>}
        </label>
      ))}
      {text.length < max && (
        <button type="button" onClick={() => setDraft({ src: values, text: [...text, ""] })} className="h-8 rounded-md border border-dashed border-border px-2 text-xs text-muted hover:text-text-2">
          Add
        </button>
      )}
      {text.length > 1 && (
        <button
          type="button"
          onClick={() => {
            const t = text.slice(0, -1);
            setDraft({ src: values, text: t });
            commit(t);
          }}
          className="h-8 rounded-md px-2 text-xs text-muted hover:text-text-2"
        >
          Remove last
        </button>
      )}
    </div>
  );
}

function ResetDemo() {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ask)
    return (
      <button type="button" onClick={() => setAsk(true)} className="h-8 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text">
        Reset demo account
      </button>
    );
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await resetDemo();
            pushToast({ tone: "good", title: "Demo account reset", body: "Back to $10,000" });
          } catch (e) {
            pushToast({ tone: "bad", title: "Could not reset", body: e instanceof Error ? e.message : String(e) });
          } finally {
            setBusy(false);
            setAsk(false);
          }
        }}
        className="h-8 rounded-lg bg-warning/90 px-3 text-xs font-medium text-bg disabled:opacity-50"
      >
        {busy ? "Resetting" : "Yes, reset"}
      </button>
      <button type="button" onClick={() => setAsk(false)} className="h-8 px-2 text-xs text-text-2 hover:text-text">
        Cancel
      </button>
    </span>
  );
}

function useNotificationPermission() {
  return useSyncExternalStore(
    (l) => {
      const t = setInterval(l, 1500);
      return () => clearInterval(t);
    },
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    () => "default",
  );
}

function DesktopPermission() {
  const p = useNotificationPermission();
  if (p === "granted") return <span className="flex items-center gap-1.5 text-xs text-positive"><Check size={14} strokeWidth={1.5} /> Allowed</span>;
  if (p === "denied") return <span className="text-xs text-muted">Blocked in the browser. Allow it in the site settings</span>;
  if (p === "unsupported") return <span className="text-xs text-muted">Not supported in this browser</span>;
  return (
    <button type="button" onClick={() => Notification.requestPermission()} className="h-8 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text">
      Allow
    </button>
  );
}

const METHOD: Record<string, string> = { google: "Google", email: "Email code", phantom: "Phantom" };

function AccountCard() {
  const account = useAccount();
  const ref = useReferral();
  const me = account.me;
  const [busy, setBusy] = useState(false);
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      pushToast({ tone: "good", title: "Copied" });
    } catch {}
  };
  return (
    <Card id="account" title="Account">
      <Row label="Signed in with">
        <span className="text-sm text-text-2">{me ? (METHOD[me.login_method] ?? me.login_method) : "…"}</span>
      </Row>
      {me?.email && (
        <Row label="Email">
          <span className="font-mono text-sm text-text-2">{me.email}</span>
        </Row>
      )}
      <Row label="Wallet" hint={me?.login_method === "phantom" ? "The Phantom wallet you signed in with" : "Connect Phantom from the top bar when you trade. It is not saved"}>
        <span className="font-mono text-sm text-text-2">{me?.wallet ? `${me.wallet.slice(0, 4)}…${me.wallet.slice(-4)}` : "None saved"}</span>
      </Row>
      <Row label="Referral link" hint={ref ? `Code ${ref.code} · ${ref.invited} joined` : "Your code is also your name on the competition board"}>
        {ref ? (
          <button type="button" onClick={() => copy(refLink(ref.code))} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text">
            <Copy size={14} strokeWidth={1.5} /> Copy link
          </button>
        ) : (
          <span className="text-xs text-muted">…</span>
        )}
      </Row>
      <Row label="Sign out" hint="Signing out everywhere ends your sessions on every device and browser">
        <span className="flex gap-2">
          <button type="button" onClick={() => signOut()} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text">
            <LogOut size={14} strokeWidth={1.5} /> This device
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOutEverywhere();
            }}
            className="h-8 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-50"
          >
            Everywhere
          </button>
        </span>
      </Row>
    </Card>
  );
}

function DataCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<{ open: boolean; text: string; busy: boolean; error: string | null }>({ open: false, text: "", busy: false, error: null });
  return (
    <Card id="data" title="Data and privacy" sub="Kixo never holds your funds or keys. This is what it keeps about you">
      <Row label="Download your data" hint="Profile, settings, demo account, demo trades, exit orders and real trade records, as one JSON file">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadMyData();
            } catch (e) {
              pushToast({ tone: "bad", title: "Download failed", body: e instanceof Error ? e.message : String(e) });
            } finally {
              setBusy(false);
            }
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <Download size={14} strokeWidth={1.5} />}
          Download
        </button>
      </Row>
      <div className="px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-negative">Delete account</p>
            <p className="mt-0.5 text-xs text-muted">Removes your profile, settings, demo account and support tickets. Real trade records stay without your name, as on-chain history and fee records require. This cannot be undone</p>
          </div>
          {!del.open && (
            <button type="button" onClick={() => setDel({ ...del, open: true })} className="h-8 shrink-0 rounded-lg border border-negative/40 px-3 text-xs text-negative hover:bg-negative/10">
              Delete account
            </button>
          )}
        </div>
        {del.open && (
          <div className="mt-4 rounded-lg border border-negative/30 bg-negative/5 p-4">
            <label className="text-xs text-text-2" htmlFor="confirm-delete">
              Type DELETE to confirm
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="confirm-delete"
                value={del.text}
                onChange={(e) => setDel({ ...del, text: e.target.value, error: null })}
                autoComplete="off"
                className="h-9 w-40 rounded-lg border border-border bg-bg px-3 font-mono text-sm text-text outline-none focus:border-negative/50"
              />
              <button
                type="button"
                disabled={del.text !== "DELETE" || del.busy}
                onClick={async () => {
                  setDel({ ...del, busy: true, error: null });
                  try {
                    await deleteMyAccount();
                    await signOut();
                    router.push("/");
                  } catch (e) {
                    setDel({ ...del, busy: false, error: e instanceof Error ? e.message : String(e) });
                  }
                }}
                className="h-9 rounded-lg bg-negative px-4 text-sm font-medium text-text disabled:opacity-40"
              >
                {del.busy ? "Deleting" : "Delete forever"}
              </button>
              <button type="button" onClick={() => setDel({ open: false, text: "", busy: false, error: null })} className="h-9 px-3 text-sm text-text-2 hover:text-text">
                Cancel
              </button>
            </div>
            {del.error && <p className="mt-2 text-xs text-negative">{del.error}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
