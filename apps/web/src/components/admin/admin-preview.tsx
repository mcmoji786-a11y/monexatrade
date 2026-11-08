"use client";

import { KixoMark } from "@/components/brand";
import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { SystemAdmin } from "./system-admin";
import { Activity, CalendarRange, LifeBuoy, UserRound, ClipboardList, FileClock, Gauge, Coins, KeyRound, Lock, Megaphone, Rocket, Settings2, ShieldCheck, SlidersHorizontal, ToggleRight, Users } from "lucide-react";
import { adminFetch, OwnerNeeded } from "@/lib/admin";
import { EarningsAdmin, UsersAdmin } from "./ops-admin";
import { MarketingAdmin } from "./marketing-admin";
import { AdminGate, AdminSignOut, ApiKeys, AuditLog, OwnerUnlock, PlatformSettings } from "./platform-admin";
import { ALL_ON, FEATURE_LIST, type Features } from "@/lib/features";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { SupportInbox } from "./support-inbox";
import { FALLBACK_CONFIG, type GatewayTier, type RewardsConfig } from "@/lib/rewards";

type View = "system" | "overview" | "users" | "earnings" | "marketing" | "live" | "features" | "platform" | "keys" | "review" | "rewards" | "creators" | "approvals" | "audit" | "team" | "support";
/** `preview`: a design only, nothing on it saves yet. */
const NAV: { key: View; label: string; icon: typeof Gauge; preview?: boolean }[] = [
  { key: "overview", label: "Dashboard", icon: Gauge },
  { key: "users", label: "Users", icon: UserRound },
  { key: "earnings", label: "Earnings", icon: Coins },
  { key: "marketing", label: "Marketing", icon: Rocket },
  { key: "live", label: "Live users and activity", icon: Activity },
  { key: "system", label: "System health", icon: HeartPulse },
  { key: "features", label: "Features", icon: ToggleRight },
  { key: "platform", label: "Platform settings", icon: Settings2 },
  { key: "keys", label: "API keys", icon: KeyRound },
  { key: "support", label: "Support inbox", icon: LifeBuoy },
  { key: "review", label: "Annual review", icon: CalendarRange, preview: true },
  { key: "rewards", label: "Rewards settings", icon: SlidersHorizontal, preview: true },
  { key: "creators", label: "Creator requests", icon: Megaphone },
  { key: "approvals", label: "Approvals", icon: ClipboardList, preview: true },
  { key: "audit", label: "Audit log", icon: FileClock },
  { key: "team", label: "Team and security", icon: Users, preview: true },
];

/** Admin workflow, design only. Reads the real rewards settings; nothing can be saved
 *  until the secure admin (separate app, login, 2FA, IP gate, audit log) exists. */
export function AdminPreview() {
  return (
    <AdminGate>
      <AdminApp />
    </AdminGate>
  );
}

function AdminApp() {
  const [view, setView] = useState<View>("overview");
  const [live, setLive] = useState<RewardsConfig>(FALLBACK_CONFIG);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/rewards/config`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: RewardsConfig | null) => c && setLive(c))
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center gap-2 border-b border-border px-5">
          <KixoMark size={22} />
          <span className="font-medium">Kixo Admin</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setView(n.key)}
              className={`flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${view === n.key ? "bg-surface-3 text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
            >
              <n.icon size={16} strokeWidth={1.5} />
              <span className="flex-1 text-left">{n.label}</span>
              {n.preview && <span className="text-[10px] text-muted">Preview</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-border p-4 text-[11px] leading-5 text-muted">
          Admin session in this tab only
          <AdminSignOut />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {NAV.find((n) => n.key === view)?.preview && (
          <div className="flex items-center gap-2 border-b border-border bg-surface px-6 py-2 text-xs text-text-2">
            Preview: this screen is a design, nothing on it saves yet
          </div>
        )}
        <div key={view} className="fade-up p-6">
          {view === "overview" && <Overview live={live} go={setView} />}
          {view === "users" && (
            <>
              <Title title="Users" sub="Every account with its Kixo wallet. Open one to see its balance, trades, transfers and tickets, or pause its trading" />
              <UsersAdmin />
            </>
          )}
          {view === "marketing" && (
            <>
              <Title title="Marketing" sub="Tracking links with their sign-up funnel, promo codes, the banner and popup, and the social links and search text" />
              <MarketingAdmin />
            </>
          )}
          {view === "earnings" && (
            <>
              <Title title="Earnings" sub="What Kixo earned from trade, deposit and withdrawal fees, from its own records" />
              <EarningsAdmin />
            </>
          )}
          {view === "live" && <Live />}
          {view === "system" && (
            <>
              <Title title="System health" sub="Is Kixo up, what went down in the last day, and every warning and error, grouped" />
              <SystemAdmin />
            </>
          )}
          {view === "features" && <FeaturesEditor />}
          {view === "review" && <Review />}
          {view === "rewards" && <RewardsEditor live={live} />}
          {view === "creators" && <Creators />}
          {view === "approvals" && <Approvals />}
          {view === "audit" && (
            <>
              <Title title="Audit log" sub="Every admin change: when, what it was before and after, and from which address. Keys are never written, only their last 4 characters" />
              <AuditLog />
            </>
          )}
          {view === "platform" && (
            <>
              <Title title="Platform settings" sub="Fees, limits, the real trading allowlist, sending tips and Sol Radar's Lower risk rules, without touching the code" />
              <div className="mb-6">
                <OwnerUnlock />
              </div>
              <PlatformSettings />
            </>
          )}
          {view === "keys" && (
            <>
              <Title title="API keys" sub="Helius, Jupiter, X, Reddit and Telegram. Set or replace a key here instead of editing .env" />
              <ApiKeys />
            </>
          )}
          {view === "team" && <Team />}
          {view === "support" && (
            <>
              <Title title="Support inbox" sub="Tickets from users, newest messages first. Replies reach the user on their Support page; internal notes stay with the team" />
              <SupportInbox />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Title({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-medium">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-2">{sub}</p>
    </div>
  );
}

function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <p className="text-sm font-medium">{title}</p>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

const PAGE_NAMES: Record<string, string> = {
  discover: "Discover",
  radar: "Sol Radar",
  token: "Trade page",
  sniper: "Sniper",
  "smart-money": "Smart Money",
  wallets: "Wallet Monitor",
  rewards: "Rewards",
  ai: "AI Intelligence",
  home: "Home",
  other: "Other pages",
};

const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`);

function Overview({ live, go }: { live: RewardsConfig; go: (v: View) => void }) {
  const m = useMetrics();
  const p = m?.presence;
  const e = m?.engine;
  const pages = pageCounts(p?.sessions ?? []);
  const days30 = (p?.days ?? []).slice(-30);
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const avgSession = p && p.sessions.length ? p.sessions.reduce((t, x) => t + x.secs, 0) / p.sessions.length : null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Dashboard</h1>
          <p className="mt-1 text-sm text-text-2">{date}</p>
        </div>
        <span className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-xs text-text-2">
          <span className={`h-1.5 w-1.5 rounded-full ${m ? "live-ring bg-emerald" : "bg-negative"}`} />
          {m ? "Live data, every 5 s" : "Gateway offline"}
        </span>
      </div>

      {/* Key numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Live now" value={p?.live_users} spark={p?.live_24h.map((x) => x[1])} accent />
        <Kpi label="Visitors today" value={p?.visitors_today} sub="Since midnight UTC" />
        <Kpi label="Peak today" value={p?.peak_live_today} sub="Most live at once" />
        <Kpi label="Avg time on site" text={avgSession != null ? dur(Math.round(avgSession)) : "—"} sub="Current sessions" />
        <Kpi label="Trade pages open" value={p?.trade_pages_open} sub="People on a coin" />
      </div>

      {/* Live over the day, and where people are */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Live users, last 24 hours" right={<span className="font-mono text-xs text-muted">{p?.live_24h.length ?? 0} samples</span>}>
          <AreaChart points={p?.live_24h ?? []} />
        </Card>
        <Card title="Where people are now" right={<span className="font-mono text-xs text-muted">{p?.sessions.length ?? 0} live</span>}>
          {pages.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted">Nobody online right now</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {pages.map(([page, n]) => (
                <li key={page}>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-2">{PAGE_NAMES[page] ?? page}</span>
                    <span className="font-mono text-text">{n}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="grow-x h-full rounded-full bg-cyan" style={{ width: `${(n / pages[0][1]) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Visitors per day, business and engine */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Visitors, last 30 days">
          <DayBars days={days30} />
        </Card>
        <Card title="Trading business" right={<span className="rounded-full border border-warning/30 px-2 py-0.5 text-[10px] text-warning">Not live</span>}>
          <dl className="grid grid-cols-2 gap-4 font-mono text-sm">
            <Mini k="Traders" v="0" />
            <Mini k="Volume" v="$0" />
            <Mini k="Fees" v="$0" />
            <Mini k="Revenue" v="$0" />
          </dl>
          <p className="mt-4 text-[11px] text-muted">These count real trades only, from the day trading is approved and switched on</p>
        </Card>
        <Card title="Engine health">
          <ul className="flex flex-col gap-2 text-xs">
            <Health label="Chain stream" ok={!!e?.stream_connected} value={e ? (e.stream_connected ? "Connected" : "Down") : "—"} />
            <Health label="Uptime" ok value={e ? dur(e.uptime_secs) : "—"} />
            <Health label="Launches seen" ok value={e ? e.launches_detected.toLocaleString() : "—"} />
            <Health label="Trades decoded" ok value={e ? e.trades_decoded.toLocaleString() : "—"} />
            <Health label="Coins on Radar / Discover" ok value={e ? `${e.launches_on_radar} / ${e.coins_on_discover}` : "—"} />
            <Health label="Smart wallets listed" ok value={e ? String(e.smart_wallets) : "—"} />
          </ul>
        </Card>
      </div>

      {/* Attention and programmes */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Needs attention">
          <ul className="flex flex-col gap-1 text-sm">
            <Todo label="Creator requests waiting" value="—" onClick={() => go("creators")} />
            <Todo label="Changes waiting for approval" value="0" onClick={() => go("approvals")} />
            <Todo label="Failed admin sign-ins today" value="0" onClick={() => go("audit")} />
          </ul>
        </Card>
        <Card title="Programmes and rates">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Prog name="Invite links" on={live.referral_enabled} />
            <Prog name="Cashback" on={live.cashback_enabled} />
            <Prog name="Creator applications" on={live.creator_open} />
            <span className="flex justify-between text-text-2">
              Trading fee <span className="font-mono text-text">{live.trading_fee_pct}%</span>
            </span>
          </div>
          {live.draft && <p className="mt-3 text-[11px] text-warning">Rates are marked as draft on the public page</p>}
        </Card>
      </div>
    </>
  );
}

function pageCounts(sessions: { page: string }[]) {
  const c = new Map<string, number>();
  for (const s of sessions) c.set(s.page, (c.get(s.page) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]);
}

function Kpi({ label, value, text, sub, spark, accent }: { label: string; value?: number; text?: string; sub?: string; spark?: number[]; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="flex items-center gap-2 text-xs text-muted">
        {accent && <span className="live-ring h-1.5 w-1.5 rounded-full bg-emerald" />}
        {label}
      </p>
      <p className={`mt-2 font-mono text-3xl ${accent ? "text-emerald" : "text-text"}`}>{text ?? (value == null ? "—" : value.toLocaleString())}</p>
      {spark && spark.length > 1 ? <MiniSpark points={spark} /> : sub ? <p className="mt-1 text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}

function MiniSpark({ points }: { points: number[] }) {
  const w = 160;
  const h = 24;
  const hi = Math.max(1, ...points);
  const d = points.map((v, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - (v / hi) * (h - 2) - 1).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-6 w-full text-emerald" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Live users through the day with hour marks; one series, one accent. */
function AreaChart({ points }: { points: [number, number][] }) {
  if (points.length < 2) return <p className="flex h-48 items-center justify-center text-xs text-muted">The line builds a point a minute while the gateway runs</p>;
  const w = 800;
  const h = 180;
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const span = Math.max(1, t1 - t0);
  const hi = Math.max(1, ...points.map((p) => p[1]));
  const x = (t: number) => ((t - t0) / span) * w;
  const y = (v: number) => h - 8 - (v / hi) * (h - 24);
  const d = points.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * span);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full text-emerald" preserveAspectRatio="none" role="img" aria-label="Live users over the last 24 hours">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={y(hi * f)} y2={y(hi * f)} stroke="currentColor" strokeOpacity="0.07" />
        ))}
        <path d={`${d}L${x(t1)},${h}L0,${h}Z`} fill="currentColor" opacity="0.1" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        {ticks.map((t) => (
          <span key={t}>{new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
        ))}
      </div>
      <p className="mt-1 text-right font-mono text-[10px] text-muted">peak {hi}</p>
    </div>
  );
}

function DayBars({ days }: { days: { day: number; visitors: number }[] }) {
  if (!days.length) return <p className="py-10 text-center text-xs text-muted">Daily totals appear here</p>;
  // Always thirty slots ending today, so a few days of data do not fill the whole width.
  const today = days[days.length - 1].day;
  const byDay = new Map(days.map((d) => [d.day, d.visitors]));
  days = Array.from({ length: 30 }, (_, i) => ({ day: today - 29 + i, visitors: byDay.get(today - 29 + i) ?? 0 }));
  const hi = Math.max(1, ...days.map((d) => d.visitors));
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {days.map((d) => (
          <div
            key={d.day}
            className={`flex-1 rounded-t-sm ${d.visitors ? "bg-cyan/70" : "bg-surface-3"}`}
            style={{ height: `${(d.visitors / hi) * 100}%`, minHeight: d.visitors ? 3 : 1 }}
            title={`${new Date(d.day * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${d.visitors} visitors`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        <span>{new Date(days[0].day * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        <span>today</span>
      </div>
    </div>
  );
}

function Health({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-text-2">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-positive" : "bg-negative"}`} />
        {label}
      </span>
      <span className="font-mono text-text">{value}</span>
    </li>
  );
}

function Prog({ name, on }: { name: string; on: boolean }) {
  return (
    <span className="flex items-center justify-between text-text-2">
      {name}
      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-positive/30 text-positive" : "border-border text-muted"}`}>{on ? "On" : "Paused"}</span>
    </span>
  );
}

function Todo({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
        <span className="text-text-2">{label}</span>
        <span className="font-mono text-text">{value}</span>
      </button>
    </li>
  );
}

/* ---------------- Users ---------------- */

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-sans text-[11px] text-muted">{k}</dt>
      <dd className="mt-0.5">{v}</dd>
    </div>
  );
}

/* ---------------- Rewards settings ---------------- */

/** Edit a draft of the settings and see exactly what would change. In the real admin
 *  "Submit for approval" sends it to the Owner; nothing goes live from here. */
function RewardsEditor({ live }: { live: RewardsConfig }) {
  const [draft, setDraft] = useState<RewardsConfig>(live);
  const [base, setBase] = useState(live);
  if (base !== live) {
    setBase(live);
    setDraft(live);
  }
  const set = (patch: Partial<RewardsConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const changes = diff(live, draft);

  return (
    <>
      <Title title="Rewards settings" sub="Change rates, tiers and switches. Every change needs the Owner's approval and is logged" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card title="Switches">
            <div className="flex flex-col gap-3">
              <Toggle label="Invite links" hint="Turns every user's invite link on or off" on={draft.referral_enabled} onChange={() => set({ referral_enabled: !draft.referral_enabled })} />
              <Toggle label="Cashback" hint="Pays part of each trader's fees back" on={draft.cashback_enabled} onChange={() => set({ cashback_enabled: !draft.cashback_enabled })} />
              <Toggle label="Creator applications" hint="Opens or closes the apply form" on={draft.creator_open} onChange={() => set({ creator_open: !draft.creator_open })} />
              <Toggle label="Show 'Draft rates' label" hint="Tells users the numbers may still change" on={draft.draft} onChange={() => set({ draft: !draft.draft })} />
            </div>
          </Card>

          <Card title="Rates">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Num label="Trading fee %" value={draft.trading_fee_pct} onChange={(v) => set({ trading_fee_pct: v })} />
              <Num label="Invite discount %" value={draft.invitee_discount_pct} onChange={(v) => set({ invitee_discount_pct: v })} />
              <Num label="Creator max share %" value={draft.creator_max_share_pct} onChange={(v) => set({ creator_max_share_pct: v })} />
              <Num label="Minimum claim, SOL" value={draft.min_claim_sol} step={0.01} onChange={(v) => set({ min_claim_sol: v })} />
            </div>
          </Card>

          <TierEditor title="Referral tiers" unit="% of invites' fees" tiers={draft.referral_tiers} onChange={(t) => set({ referral_tiers: t })} />
          <TierEditor title="Cashback tiers" unit="% of own fees back" tiers={draft.cashback_tiers} onChange={(t) => set({ cashback_tiers: t })} />
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
          <Card title="Your changes" right={<span className="font-mono text-xs text-muted">{changes.length}</span>}>
            {changes.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">Edit a value to see the change here</p>
            ) : (
              <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {changes.map((c) => (
                  <li key={c.field} className="rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs">
                    <p className="text-text-2">{c.field}</p>
                    <p className="mt-0.5 font-mono">
                      <span className="text-negative line-through">{c.from}</span>
                      <span className="mx-2 text-muted">→</span>
                      <span className="text-positive">{c.to}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-3 flex flex-col gap-1 text-xs text-muted">
              Reason (required)
              <textarea rows={2} placeholder="Why this change" className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50" />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setDraft(live)} disabled={!changes.length} className="h-9 flex-1 rounded-lg border border-border text-sm text-text-2 hover:text-text disabled:opacity-40">
                Discard
              </button>
              <button type="button" disabled title="Available in the secure admin" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-text text-sm font-medium text-bg opacity-40">
                <KeyRound size={13} strokeWidth={1.5} />
                Submit for approval
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">Asks for your 2FA code. Goes live 1 hour after the Owner approves</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function diff(a: RewardsConfig, b: RewardsConfig) {
  const out: { field: string; from: string; to: string }[] = [];
  const show = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : String(v));
  const labels: Record<string, string> = {
    draft: "Draft label",
    trading_fee_pct: "Trading fee %",
    referral_enabled: "Invite links",
    invitee_discount_pct: "Invite discount %",
    cashback_enabled: "Cashback",
    creator_open: "Creator applications",
    creator_max_share_pct: "Creator max share %",
    min_claim_sol: "Minimum claim SOL",
  };
  for (const k of Object.keys(labels) as (keyof RewardsConfig)[]) {
    if (a[k] !== b[k]) out.push({ field: labels[k], from: show(a[k]), to: show(b[k]) });
  }
  for (const [key, name] of [["referral_tiers", "Referral"], ["cashback_tiers", "Cashback"]] as const) {
    const x = a[key];
    const y = b[key];
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) {
      const p = x[i];
      const q = y[i];
      const f = (t?: GatewayTier) => (t ? `${t.name} ${t.pct}% from $${t.min_usd.toLocaleString()}` : "none");
      if (JSON.stringify(p) !== JSON.stringify(q)) out.push({ field: `${name} tier ${i + 1}`, from: f(p), to: f(q) });
    }
  }
  return out;
}

function TierEditor({ title, unit, tiers, onChange }: { title: string; unit: string; tiers: GatewayTier[]; onChange: (t: GatewayTier[]) => void }) {
  const set = (i: number, patch: Partial<GatewayTier>) => onChange(tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  return (
    <Card
      title={title}
      right={
        tiers.length < 8 && (
          <button type="button" onClick={() => onChange([...tiers, { name: "New tier", unlock: "", min_usd: (tiers.at(-1)?.min_usd ?? 0) * 2 || 1000, pct: tiers.at(-1)?.pct ?? 0 }])} className="text-xs text-text-2 hover:text-text">
            + Add tier
          </button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-140 text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-2 font-normal">Name</th>
              <th className="pb-2 font-normal">Unlock text</th>
              <th className="pb-2 font-normal">From, $</th>
              <th className="pb-2 font-normal">{unit}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <input value={t.name} onChange={(e) => set(i, { name: e.target.value.slice(0, 24) })} className="h-8 w-28 rounded-md border border-border bg-bg px-2 text-sm outline-none focus:border-emerald/50" />
                </td>
                <td className="py-1 pr-2">
                  <input value={t.unlock} onChange={(e) => set(i, { unlock: e.target.value.slice(0, 80) })} className="h-8 w-full min-w-48 rounded-md border border-border bg-bg px-2 text-sm outline-none focus:border-emerald/50" />
                </td>
                <td className="py-1 pr-2">
                  <input type="number" min={0} value={t.min_usd} onChange={(e) => set(i, { min_usd: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-28 rounded-md border border-border bg-bg px-2 font-mono text-sm outline-none focus:border-emerald/50" />
                </td>
                <td className="py-1 pr-2">
                  <input type="number" min={0} max={100} value={t.pct} onChange={(e) => set(i, { pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className="h-8 w-20 rounded-md border border-border bg-bg px-2 font-mono text-sm outline-none focus:border-emerald/50" />
                </td>
                <td className="py-1 text-right">
                  {tiers.length > 1 && (
                    <button type="button" onClick={() => onChange(tiers.filter((_, k) => k !== i))} className="text-xs text-muted hover:text-negative">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onChange}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${on ? "border-emerald/50 bg-emerald/30" : "border-border bg-surface-3"}`}
      >
        <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${on ? "left-5.5 bg-emerald" : "left-0.5 bg-text-2"}`} />
      </button>
    </div>
  );
}

function Num({ label, value, step = 0.5, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted">
      {label}
      <input type="number" min={0} step={step} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} className="h-9 rounded-lg border border-border bg-bg px-2 font-mono text-sm text-text outline-none focus:border-emerald/50" />
    </label>
  );
}

/* ---------------- Creator requests ---------------- */

function Creators() {
  return (
    <>
      <Title title="Creator requests" sub="Applications from the Rewards page. Open one, check the profiles, approve or decline with a note" />
      <div className="mb-4 flex flex-wrap gap-2">
        {["Waiting", "Approved", "Declined", "All"].map((t, i) => (
          <span key={t} className={`h-8 rounded-lg px-3 text-sm leading-8 ${i === 0 ? "bg-surface-3 text-text" : "text-text-2"}`}>
            {t}
          </span>
        ))}
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className="h-9 border-b border-border text-left text-xs text-muted">
                <th className="font-normal">Received</th>
                <th className="font-normal">Name</th>
                <th className="font-normal">Socials</th>
                <th className="font-normal">Audience</th>
                <th className="font-normal">Contact</th>
                <th className="font-normal">Status</th>
                <th />
              </tr>
            </thead>
          </table>
        </div>
        <div className="flex flex-col items-center gap-2 px-8 py-12 text-center">
          <Lock size={18} strokeWidth={1.5} className="text-muted" />
          <p className="text-sm text-text-2">Requests are stored safely on the gateway</p>
          <p className="max-w-md text-xs text-muted">They show here once you sign in to the secure admin. Each request opens a side panel with the social links, a profile check list and Approve / Decline</p>
        </div>
      </Card>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Flow n={1} title="Review" body="Open the request, visit each social link, check the audience is real" />
        <Flow n={2} title="Decide" body="Approve with a creator share, or decline with a reason the creator sees" />
        <Flow n={3} title="Onboard" body="Approved creators get their code and creator page; the decision is logged" />
      </div>
    </>
  );
}

/* ---------------- Approvals ---------------- */

function Approvals() {
  return (
    <>
      <Title title="Approvals" sub="Two people for every money change: one proposes, the Owner approves with 2FA" />
      <div className="grid gap-4 md:grid-cols-4">
        <Flow n={1} title="Propose" body="An admin edits settings and submits with a reason and 2FA" />
        <Flow n={2} title="Approve" body="The Owner sees the exact before and after, then approves with 2FA" />
        <Flow n={3} title="Wait" body="It goes live 1 hour later; either person can cancel in that hour" />
        <Flow n={4} title="Live and logged" body="The change applies and stays in the audit log for good" />
      </div>
      <Card title="Waiting for approval">
        <p className="py-8 text-center text-xs text-muted">No changes waiting</p>
      </Card>
    </>
  );
}

function Flow({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald/40 font-mono text-xs text-emerald">{n}</span>
      <p className="mt-3 text-sm">{title}</p>
      <p className="mt-1 text-xs leading-5 text-text-2">{body}</p>
    </div>
  );
}

/* ---------------- Audit log ---------------- */

const ROLES: { role: string; can: string[] }[] = [
  { role: "Owner", can: ["Everything", "Approve money changes", "Add or remove team members"] },
  { role: "Admin", can: ["Propose settings changes", "Review creator requests", "Read the audit log"] },
  { role: "Reviewer", can: ["Review creator requests"] },
  { role: "Viewer", can: ["Read only"] },
];

function Team() {
  return (
    <>
      <Title title="Team and security" sub="Who can do what, and how the admin is protected" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Roles">
          <ul className="flex flex-col gap-2">
            {ROLES.map((r) => (
              <li key={r.role} className="rounded-xl border border-border p-3">
                <p className="text-sm">{r.role}</p>
                <p className="mt-1 text-xs text-text-2">{r.can.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Protection">
          <ul className="flex flex-col gap-2.5">
            {[
              "Separate admin app on its own address, no link from the main site",
              "Hidden behind Cloudflare Zero Trust or an IP allowlist",
              "Login with 2FA: authenticator app or hardware key",
              "30-minute idle sessions, secure cookies only",
              "2FA again for money changes, Owner approval, 1-hour delay",
              "Audit log of every action; alerts on every sign-in",
              "Lock after repeated failed logins",
            ].map((x) => (
              <li key={x} className="flex gap-2 text-xs text-text-2">
                <ShieldCheck size={14} strokeWidth={1.5} className="mt-px shrink-0 text-emerald" />
                {x}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/* ---------------- Live users and activity ---------------- */

type Metrics = {
  presence: {
    live_users: number;
    trade_pages_open: number;
    visitors_today: number;
    peak_live_today: number;
    days: { day: number; visitors: number; peak_live: number }[];
    sessions: { page: string; secs: number }[];
    live_24h: [number, number][];
  };
  engine: { uptime_secs: number; launches_detected: number; trades_decoded: number; launches_on_radar: number; coins_on_discover: number; smart_wallets: number; stream_connected: boolean };
  business: { trading_live: boolean; traders: number; volume_usd: number; fees_usd: number; revenue_usd: number };
};

/** Gateway metrics every few seconds; null while unreachable. */
function useMetrics(everyMs = 5_000) {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${GATEWAY_HTTP}/metrics/public`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((x: Metrics | null) => alive && x && setM(x))
        .catch(() => {});
    load();
    const id = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [everyMs]);
  return m;
}

function Big({ label, value, sub, live }: { label: string; value: string; sub?: string; live?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="flex items-center gap-2 text-xs text-muted">
        {live && <span className="live-ring h-1.5 w-1.5 rounded-full bg-emerald" />}
        {label}
      </p>
      <p className="mt-2 font-mono text-3xl text-text">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Live() {
  const m = useMetrics();
  const p = m?.presence;
  const e = m?.engine;
  const b = m?.business;
  const n = (v: number | undefined) => (v == null ? "—" : v.toLocaleString());
  const h = e ? (e.uptime_secs / 3600).toFixed(1) : "—";
  return (
    <>
      <Title title="Live users and activity" sub="Counted on the gateway every 5 seconds. Visitors are counted without accounts or cookies, as anonymous daily hashes" />
      <p className="mb-3 text-xs text-muted">People</p>
      <div className="grid gap-4 md:grid-cols-4">
        <Big label="Live users now" value={n(p?.live_users)} sub="Open Kixo tabs" live />
        <Big label="Trade pages open" value={n(p?.trade_pages_open)} sub="People looking at a coin" live />
        <Big label="Visitors today" value={n(p?.visitors_today)} sub="Since midnight UTC" />
        <Big label="Peak today" value={n(p?.peak_live_today)} sub="Most live users at once" />
      </div>

      <p className="mt-8 mb-3 text-xs text-muted">Trading business</p>
      <div className="grid gap-4 md:grid-cols-4">
        <Big label="Traders" value={n(b?.traders)} sub="Starts with trading" />
        <Big label="Volume" value={b ? `$${b.volume_usd.toLocaleString()}` : "—"} sub="Starts with trading" />
        <Big label="Fees" value={b ? `$${b.fees_usd.toLocaleString()}` : "—"} sub="Starts with trading" />
        <Big label="Revenue" value={b ? `$${b.revenue_usd.toLocaleString()}` : "—"} sub="Fees minus rewards paid" />
      </div>
      {b && !b.trading_live && <p className="mt-2 text-[11px] text-warning">Trading is not live yet: these stay at zero until it is approved and switched on</p>}

      <p className="mt-8 mb-3 text-xs text-muted">Engine</p>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Big label="Chain stream" value={e ? (e.stream_connected ? "Live" : "Down") : "—"} sub={`Up ${h} h`} />
        <Big label="Launches seen" value={n(e?.launches_detected)} sub="Since start" />
        <Big label="Trades decoded" value={n(e?.trades_decoded)} sub="Since start" />
        <Big label="On Sol Radar" value={n(e?.launches_on_radar)} sub="Coins now" />
        <Big label="On Discover" value={n(e?.coins_on_discover)} sub="Coins now" />
        <Big label="Smart wallets" value={n(e?.smart_wallets)} sub="Listed now" />
      </div>
      {!m && <p className="mt-4 text-xs text-negative">Gateway offline</p>}
    </>
  );
}

/* ---------------- Features ---------------- */

function FeaturesEditor() {
  const [live, setLive] = useState<Features>(ALL_ON);
  const [draft, setDraft] = useState<Features>(ALL_ON);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/features`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((f: Features | null) => {
        if (f) {
          setLive({ ...ALL_ON, ...f });
          setDraft({ ...ALL_ON, ...f });
        }
      })
      .catch(() => {});
  }, []);
  const set = (patch: Partial<Features>) => setDraft((d) => ({ ...d, ...patch }));
  const changed = (Object.keys(draft) as (keyof Features)[]).filter((k) => draft[k] !== live[k]);
  const [needOwner, setNeedOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [trade, setTrade] = useState<{ ready: boolean; not_ready: string | null } | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/trade/config`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setTrade({ ready: c.ready, not_ready: c.not_ready ?? null }))
      .catch(() => {});
  }, [live]);
  const walletOk = draft.fee_wallet.trim() === "" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(draft.fee_wallet.trim());
  async function apply() {
    setSaving(true);
    setMsg(null);
    try {
      const out = await adminFetch<Features>("/admin/features", { method: "PUT", body: { ...draft, fee_wallet: draft.fee_wallet.trim() } });
      const saved = { ...ALL_ON, ...out };
      setLive(saved);
      setDraft(saved);
      setNeedOwner(false);
      setMsg({ ok: true, text: "Saved. Every visitor gets it within a minute" });
    } catch (e) {
      if (e instanceof OwnerNeeded) setNeedOwner(true);
      else setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Title title="Features" sub="Switch any part of Kixo off for everyone, post an announcement, or put the site in maintenance. Every new feature gets a switch here" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card title="Features">
            <div className="grid gap-3 md:grid-cols-2">
              {FEATURE_LIST.map((x) => (
                <div key={x.key} className="rounded-xl border border-border p-3">
                  <Toggle label={x.label} hint={x.hint} on={draft[x.key] as boolean} onChange={() => set({ [x.key]: !draft[x.key] } as Partial<Features>)} />
                </div>
              ))}
            </div>
          </Card>
          <Card title="Real trading">
            <p className="text-xs text-text-2">
              Platform fees go to this wallet: 0.5% on trades, 1% on deposits and withdrawals. Paste its public address only, never a private key or seed phrase. It must already hold at least 0.01 SOL
            </p>
            <input
              value={draft.fee_wallet}
              onChange={(e) => set({ fee_wallet: e.target.value.trim().slice(0, 44) })}
              placeholder="Fee wallet address"
              spellCheck={false}
              className={`mt-3 h-9 w-full rounded-lg border bg-bg px-3 font-mono text-sm outline-none placeholder:text-muted focus:border-emerald/50 ${walletOk ? "border-border" : "border-negative/60"}`}
            />
            {!walletOk && <p className="mt-1 text-xs text-negative">Not a Solana address</p>}
            <p className={`mt-2 text-xs ${trade?.ready ? "text-positive" : "text-warning"}`}>
              {trade == null ? "Checking the trading setup" : trade.ready ? "Ready: fee wallet set and funded" : (trade.not_ready ?? "Not ready")}
            </p>
            <p className="mt-1 text-[11px] text-muted">Turn on Real trading in Features only after the security review and a small live test</p>
          </Card>
          <Card title="Announcement">
            <Toggle label="Show announcement bar" hint="A line above every page" on={draft.announcement_on} onChange={() => set({ announcement_on: !draft.announcement_on })} />
            <input
              value={draft.announcement}
              onChange={(e) => set({ announcement: e.target.value.slice(0, 200) })}
              placeholder="e.g. New: Safety score on every coin"
              className="mt-3 h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-emerald/50"
            />
            {draft.announcement_on && draft.announcement && (
              <p className="mt-3 rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-2 text-center text-xs">Preview: {draft.announcement}</p>
            )}
          </Card>
          <Card title="Maintenance">
            <Toggle label="Maintenance mode" hint="Every page shows the message below instead" on={draft.maintenance} onChange={() => set({ maintenance: !draft.maintenance })} />
            <input
              value={draft.maintenance_message}
              onChange={(e) => set({ maintenance_message: e.target.value.slice(0, 200) })}
              className="mt-3 h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-emerald/50"
            />
          </Card>
        </div>
        <Card title="Your changes" right={<span className="font-mono text-xs text-muted">{changed.length}</span>}>
          {changed.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">Flip a switch to see the change here</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {changed.map((k) => (
                <li key={k} className="rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs">
                  <p className="text-text-2">{FEATURE_LIST.find((x) => x.key === k)?.label ?? k}</p>
                  <p className="mt-0.5 font-mono">
                    <span className="text-negative line-through">{String(live[k]) || "—"}</span>
                    <span className="mx-2 text-muted">→</span>
                    <span className="text-positive">{String(draft[k]) || "—"}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          {needOwner && (
            <div className="mt-3">
              <OwnerUnlock compact />
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setDraft(live)} disabled={!changed.length} className="h-9 flex-1 rounded-lg border border-border text-sm text-text-2 hover:text-text disabled:opacity-40">
              Discard
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!changed.length || !walletOk || saving}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-text text-sm font-medium text-bg disabled:opacity-40"
            >
              <KeyRound size={13} strokeWidth={1.5} />
              {saving ? "Saving" : "Apply"}
            </button>
          </div>
          {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
          <p className="mt-2 text-[11px] text-muted">Switches apply within a minute for every visitor. The fee wallet, Real trading and Wallet deposits also need the owner code</p>
        </Card>
      </div>
    </>
  );
}

/* ---------------- Annual review ---------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Review() {
  const m = useMetrics(60_000);
  const year = new Date().getUTCFullYear();
  const [y, setY] = useState(year);
  const months = MONTHS.map((name, i) => {
    const days = (m?.presence.days ?? []).filter((d) => {
      const date = new Date(d.day * 86_400_000);
      return date.getUTCFullYear() === y && date.getUTCMonth() === i;
    });
    return { name, visitors: days.reduce((t, d) => t + d.visitors, 0), peak: days.reduce((t, d) => Math.max(t, d.peak_live), 0), days: days.length };
  });
  const top = Math.max(1, ...months.map((x) => x.visitors));
  const total = months.reduce((t, x) => t + x.visitors, 0);

  return (
    <>
      <Title title="Annual review" sub="Month by month for the year: visitors, peak live users and, once trading is live, traders, volume, fees and revenue" />
      <div className="mb-4 flex items-center gap-2">
        {[year - 1, year].map((v) => (
          <button key={v} type="button" onClick={() => setY(v)} aria-pressed={y === v} className={`h-8 rounded-lg px-3 font-mono text-sm ${y === v ? "bg-surface-3 text-text" : "text-text-2 hover:text-text"}`}>
            {v}
          </button>
        ))}
        <span className="ml-auto font-mono text-xs text-muted">{total.toLocaleString()} visitor-days counted</span>
      </div>
      <Card title="Visitors per month">
        <div className="flex h-44 items-end gap-2">
          {months.map((x) => (
            <div key={x.name} className="flex flex-1 flex-col items-center gap-1" title={`${x.name}: ${x.visitors.toLocaleString()} visitors, peak ${x.peak} live`}>
              <span className="font-mono text-[10px] text-muted">{x.visitors ? x.visitors.toLocaleString() : ""}</span>
              <div className="w-full rounded-t-md bg-cyan/70 transition-[height] duration-500" style={{ height: `${(x.visitors / top) * 120}px`, minHeight: x.visitors ? 3 : 0 }} />
              <span className="text-[10px] text-muted">{x.name}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted">Visitors are counted once per day each, so a month adds up daily visitors. Counting started when this gateway first ran</p>
      </Card>
      <div className="mt-6">
        <Card title="Month by month">
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead>
                <tr className="h-9 border-b border-border text-left text-xs text-muted">
                  <th className="font-normal">Month</th>
                  <th className="text-right font-normal">Visitors</th>
                  <th className="text-right font-normal">Peak live</th>
                  <th className="text-right font-normal">Traders</th>
                  <th className="text-right font-normal">Volume</th>
                  <th className="text-right font-normal">Fees</th>
                  <th className="text-right font-normal">Rewards paid</th>
                  <th className="text-right font-normal">Revenue</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {months.map((x) => (
                  <tr key={x.name} className="h-9 border-b border-border last:border-0">
                    <td className="font-sans text-text-2">{x.name}</td>
                    <td className="text-right">{x.days ? x.visitors.toLocaleString() : "—"}</td>
                    <td className="text-right">{x.days ? x.peak : "—"}</td>
                    <td className="text-right text-muted">0</td>
                    <td className="text-right text-muted">$0</td>
                    <td className="text-right text-muted">$0</td>
                    <td className="text-right text-muted">$0</td>
                    <td className="text-right text-muted">$0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-warning">Traders, volume, fees, rewards and revenue start counting when trading goes live</p>
        </Card>
      </div>
    </>
  );
}
