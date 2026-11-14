"use client";

import { useSniperAccount } from "./sniper-engine";
import Link from "next/link";
import { Crosshair, Image as ImageIcon, RotateCcw, X } from "lucide-react";
import { openShareCard } from "@/lib/share";
import { useFeatures } from "@/lib/features";
import { sol } from "@/lib/gateway";
import { tokenHref } from "@/lib/open-token";
import { activePreset, DEFAULT_SNIPER, pnl, PRESETS, snipeShare, useSniper, useSniperScan, type SniperSettings, type SnipePosition } from "@/lib/sniper";
import { useMode } from "@/lib/demo";
import { useAccount } from "@/lib/account";
import { formatAge, useNow, useRadarFeed } from "@/components/radar/use-radar-feed";
import { Tick } from "@/components/token/tick";
import { TradeLink } from "@/components/token/trade-link";
import { AmountField, Field, Switch } from "./sniper-menu";

/** Sniper page: dashboard (P&L, win rate, equity curve), open and closed snipes, and
 *  every rule. In demo mode it trades the demo account; otherwise it is on paper. */
export function SniperBoard() {
  const sn = useSniper();
  const mode = useMode();
  const account = useAccount();
  const onDemo = mode === "demo" && account.status === "signed-in";
  const where = useSniperAccount();
  const { tokens, solUsd } = useRadarFeed();
  const now = useNow();
  const s = sn.settings;
  const price = (mint: string) => tokens.find((t) => t.mint === mint)?.market?.price_sol ?? null;
  const open = sn.positions.filter((p) => !p.exitTs);
  const closed = sn.positions.filter((p) => p.exitTs);

  const realized = closed.reduce((t, p) => t + (pnl(p, null).sol ?? 0), 0);
  const unrealized = open.reduce((t, p) => t + (pnl(p, price(p.mint)).sol ?? 0), 0);
  const wins = closed.filter((p) => (pnl(p, null).sol ?? 0) > 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : null;
  const best = closed.reduce<number | null>((b, p) => Math.max(b ?? -Infinity, pnl(p, null).pct ?? -Infinity), null);

  // Equity: realised profit after each closed snipe, oldest first.
  const curve = equityCurve(closed);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text">Sniper</h1>
            {where.account === "real" ? (
              <span className="rounded-md border border-emerald/40 px-2 py-0.5 text-xs text-emerald">Real SOL</span>
            ) : onDemo ? (
              <span className="rounded-md border border-cyan/30 px-2 py-0.5 text-xs text-cyan">Demo account</span>
            ) : (
              <span className="rounded-md border border-warning/30 px-2 py-0.5 text-xs text-warning">Paper mode</span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Buys new launches that pass your rules the moment they qualify, and sells on your take profit, stop loss or time limit.{" "}
            {where.account === "real"
              ? "Every buy and sell is a real trade from your Kixo wallet, checked and signed in this browser. It runs while Kixo is open and the wallet is unlocked"
              : onDemo
                ? "Every buy and sell is an order on your demo account, filled at live prices with fees. It runs while Kixo is open in this browser"
                : (where.why ?? "Prices are real; buys are simulated. Switch to Demo to trade the sniper on your demo balance")}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <span className={`h-2 w-2 rounded-full ${s.enabled ? "live-ring bg-emerald" : "bg-muted"}`} />
          <span className="text-sm text-text">{s.enabled ? "Sniping" : "Off"}</span>
          <Switch on={s.enabled} onChange={() => sn.update({ enabled: !s.enabled })} label="Sniper on" />
        </div>
      </div>

      {mode === "real" && account.status === "signed-in" && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="max-w-2xl">
            <p className="text-sm text-text">Use real SOL</p>
            <p className="mt-0.5 text-xs text-text-2">
              The sniper buys and sells from your Kixo wallet, with the same checks as a manual trade. Real money can be lost fast on new launches. It only trades while this tab is open and the wallet is unlocked
            </p>
            {s.realEnabled && where.why && <p className="mt-1 text-xs text-warning">{where.why}</p>}
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-text-2">
              Most per 24 h
              <span className="flex h-8 items-center gap-1 rounded-lg border border-border bg-bg px-2">
                <input type="number" min={0.01} step={0.1} value={s.realDailyCapSol} onChange={(e) => sn.update({ realDailyCapSol: Math.max(0.01, Number(e.target.value) || 0.01) })} className="w-16 bg-transparent font-mono text-sm tabular-nums text-text outline-none" />
                <span className="text-muted">SOL</span>
              </span>
            </label>
            <Switch
              on={s.realEnabled}
              onChange={() => {
                if (!s.realEnabled && !confirm(`Let the sniper trade real SOL from your Kixo wallet, up to ${s.realDailyCapSol} SOL a day? You can turn it off at any time`)) return;
                sn.update({ realEnabled: !s.realEnabled });
              }}
              label="Use real SOL"
            />
          </div>
        </div>
      )}

      {/* Dashboard */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="Realised P&L" value={`${realized >= 0 ? "+" : ""}${sol(realized)}`} sub={dollars(realized, solUsd)} raw={realized} tone={realized >= 0 ? "text-positive" : "text-negative"} />
          <Stat label="Open P&L" value={`${unrealized >= 0 ? "+" : ""}${sol(unrealized)}`} sub={dollars(unrealized, solUsd)} raw={unrealized} tone={unrealized >= 0 ? "text-positive" : "text-negative"} />
          <Stat label="Win rate" value={winRate != null ? `${winRate.toFixed(0)}%` : "—"} sub={`${wins} of ${closed.length} closed`} raw={winRate} />
          <Stat label="Best snipe" value={best != null && Number.isFinite(best) ? `${best >= 0 ? "+" : ""}${best.toFixed(0)}%` : "—"} sub={`${open.length} open now`} />
        </dl>
        <div className="flex flex-col rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text">Realised profit over time</span>
            <span className="font-mono text-xs text-muted">{closed.length} snipes</span>
          </div>
          <Equity points={curve} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <Positions title="Open snipes" list={open} price={price} now={now} solUsd={solUsd} onClose={(p) => sn.close(p.id, price(p.mint) ?? p.entryPrice)} empty={s.enabled ? <ScanStatus /> : "Turn the sniper on to start"} />
          <Positions title="History" list={closed} price={price} now={now} solUsd={solUsd} empty="No closed snipes yet" action={closed.length ? <button type="button" onClick={sn.clearHistory} className="text-xs text-muted hover:text-text">Clear</button> : null} />
        </div>
        <Settings s={s} update={sn.update} reset={sn.reset} solUsd={solUsd} />
      </div>
    </section>
  );
}

function Positions({
  title,
  list,
  price,
  now,
  solUsd,
  onClose,
  empty,
  action,
}: {
  title: string;
  list: SnipePosition[];
  price: (m: string) => number | null;
  now: number;
  solUsd: number | null;
  onClose?: (p: SnipePosition) => void;
  empty: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <span className="flex items-baseline gap-2 text-sm text-text">
          {title}
          <span className="font-mono text-xs text-muted">{list.length}</span>
        </span>
        {action}
      </div>
      {list.length === 0 ? (
        <p className="flex flex-col items-center gap-2 px-8 py-10 text-center text-sm text-muted">
          <Crosshair size={18} strokeWidth={1.5} />
          {empty}
        </p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-160 text-sm whitespace-nowrap">
            <thead className="sticky top-0 bg-surface">
              <tr className="h-9 border-b border-border text-left text-xs text-muted">
                <th className="pl-4 font-normal">Coin</th>
                <th className="px-3 text-right font-normal">Size</th>
                <th className="px-3 text-right font-normal">Entry MC</th>
                <th className="px-3 text-right font-normal">Safety</th>
                <th className="px-3 text-right font-normal">P&amp;L</th>
                <th className="px-3 font-normal">{onClose ? "Held" : "Exit"}</th>
                <th className="pr-4" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const r = pnl(p, p.exitTs ? null : price(p.mint));
                const up = (r.sol ?? 0) >= 0;
                return (
                  <tr key={p.id} className="row-in h-11 border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="pl-4">
                      <Link href={tokenHref(p.mint)} className="text-text hover:text-cyan">
                        {p.symbol || `${p.mint.slice(0, 4)}…`}
                      </Link>
                    </td>
                    <td className="px-3 text-right font-mono text-text-2">
                      {sol(p.sizeSol)}
                      {solUsd ? <span className="ml-1.5 text-xs text-muted">${(p.sizeSol * solUsd).toFixed(2)}</span> : null}
                    </td>
                    <td className="px-3 text-right font-mono text-text-2">{p.entryMcSol.toFixed(1)} SOL</td>
                    <td className={`px-3 text-right font-mono ${p.entrySafety == null ? "text-muted" : p.entrySafety >= 75 ? "text-positive" : p.entrySafety >= 50 ? "text-warning" : "text-negative"}`}>
                      {p.entrySafety != null ? `${p.entrySafety}%` : "—"}
                    </td>
                    <td className={`px-3 text-right font-mono ${r.sol == null ? "text-muted" : up ? "text-positive" : "text-negative"}`}>
                      <Tick value={r.pct}>
                        {r.sol == null ? "—" : `${up ? "+" : ""}${sol(r.sol)}`}
                        {r.pct != null && <span className="ml-1.5 text-xs opacity-80">{`${up ? "+" : ""}${r.pct.toFixed(0)}%`}</span>}
                      </Tick>
                    </td>
                    <td className="px-3 text-xs text-text-2">
                      {onClose ? (now ? formatAge(now / 1000 - p.entryTs) : "—") : <ExitTag reason={p.reason} />}
                    </td>
                    <td className="pr-4 text-right">
                      <span className="inline-flex items-center gap-2">
                        {onClose && (
                          <button
                            type="button"
                            onClick={() => onClose(p)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-text-2 hover:border-negative/40 hover:text-negative"
                          >
                            <X size={12} strokeWidth={1.5} />
                            Sell
                          </button>
                        )}
                        {!onClose && <CardButton p={p} />}
                        <TradeLink mint={p.mint} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The share card of a closed demo snipe, from its actual sell fill. Paper and real
 *  snipes have none (the card says "Demo account"). */
function CardButton({ p }: { p: SnipePosition }) {
  const shareOn = useFeatures().share_cards;
  const card = snipeShare(p);
  if (!shareOn || !card) return null;
  return (
    <button
      type="button"
      onClick={() => openShareCard(card)}
      aria-label={`Share card for ${p.symbol || "this snipe"}`}
      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-text-2 hover:bg-surface-3 hover:text-text"
    >
      <ImageIcon size={12} strokeWidth={1.5} />
      Card
    </button>
  );
}

function ExitTag({ reason }: { reason?: string }) {
  const tone = reason === "take profit" || reason === "trailing stop" ? "border-positive/30 text-positive" : reason === "stop loss" || reason === "dropped" ? "border-negative/30 text-negative" : "border-border text-text-2";
  return <span className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] ${tone}`}>{reason ?? "—"}</span>;
}

function Settings({ s, update, reset, solUsd }: { s: SniperSettings; update: (p: Partial<SniperSettings>) => void; reset: () => void; solUsd: number | null }) {
  const opt = (v: number | null) => v ?? 0;
  return (
    <aside className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-4">
      <div className="grid grid-cols-3 gap-1.5">
        {PRESETS.map((pr) => (
          <button
            key={pr.key}
            type="button"
            onClick={() => update(pr.patch)}
            title={pr.hint}
            aria-pressed={activePreset(s) === pr.key}
            className={`h-9 rounded-lg border text-sm transition-colors ${activePreset(s) === pr.key ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-border text-text-2 hover:text-text"}`}
          >
            {pr.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">Rules</span>
        <button type="button" onClick={reset} className="flex items-center gap-1 text-xs text-muted hover:text-text" title={`Back to defaults (${DEFAULT_SNIPER.buySol} SOL, +${DEFAULT_SNIPER.takeProfitPct}% / −${DEFAULT_SNIPER.stopLossPct}%)`}>
          <RotateCcw size={12} strokeWidth={1.5} />
          Defaults
        </button>
      </div>

      <Group title="Buy">
        <AmountField s={s} update={update} solUsd={solUsd} />
        <Field label="Max coin age, s" value={s.maxAgeSecs} step={10} onChange={(v) => update({ maxAgeSecs: v })} />
        <Field label="Costs, %" value={s.slippagePct} step={0.5} onChange={(v) => update({ slippagePct: v })} />
      </Group>

      <Group title="Sell">
        <Field label="Take profit, %" value={s.takeProfitPct} step={5} onChange={(v) => update({ takeProfitPct: v })} />
        <Field label="Stop loss, %" value={s.stopLossPct} step={5} onChange={(v) => update({ stopLossPct: v })} />
        <Field label="Trailing stop, %" value={s.trailingPct} step={5} onChange={(v) => update({ trailingPct: v })} />
        <Field label="Max hold, min" value={s.maxHoldMins} step={5} onChange={(v) => update({ maxHoldMins: v })} />
      </Group>
      <p className="-mt-3 text-[10px] text-muted">Trailing stop sells when the price falls that far from its best since the buy. 0 turns it off</p>

      <div>
        <p className="mb-1 flex justify-between text-xs text-muted">
          Minimum safety score
          <span className={`font-mono ${s.minSafety >= 75 ? "text-positive" : s.minSafety >= 50 ? "text-warning" : "text-negative"}`}>{s.minSafety}%</span>
        </p>
        <input type="range" min={0} max={90} step={5} value={s.minSafety} onChange={(e) => update({ minSafety: Number(e.target.value) })} className="w-full accent-emerald" aria-label="Minimum safety score" />
      </div>

      <Group title="Coin must have">
        <Field label="Min holders" value={opt(s.minHolders)} step={5} onChange={(v) => update({ minHolders: v || null })} />
        <Field label="Min trades" value={opt(s.minTrades)} step={5} onChange={(v) => update({ minTrades: v || null })} />
        <Field label="Max dev %" value={opt(s.maxDevPct)} step={1} onChange={(v) => update({ maxDevPct: v || null })} />
        <Field label="Max top 10 %" value={opt(s.maxTop10Pct)} step={5} onChange={(v) => update({ maxTop10Pct: v || null })} />
        <Field label="Max bundles %" value={opt(s.maxBundlePct)} step={5} onChange={(v) => update({ maxBundlePct: v || null })} />
        <Field label="Max early buyers %" value={opt(s.maxEarlyBuyerPct)} step={5} onChange={(v) => update({ maxEarlyBuyerPct: v || null })} />
      </Group>

      <div className="flex flex-col gap-2">
        <Check label="Social links required" on={s.socialsRequired} onChange={() => update({ socialsRequired: !s.socialsRequired })} />
        <Check label="Skip copied symbols" on={s.skipCopiedSymbols} onChange={() => update({ skipCopiedSymbols: !s.skipCopiedSymbols })} />
        <Check label="Skip devs who rugged before" on={s.skipRepeatRuggers} onChange={() => update({ skipRepeatRuggers: !s.skipRepeatRuggers })} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">Alert on every buy and sell</p>
        <Check label="Pop-up in Kixo" on={s.notifyToast} onChange={() => update({ notifyToast: !s.notifyToast })} />
        <Check label="Sound" on={s.notifySound} onChange={() => update({ notifySound: !s.notifySound })} />
        <Check
          label="Desktop notification"
          on={s.notifyDesktop}
          onChange={async () => {
            if (!s.notifyDesktop && typeof Notification !== "undefined" && Notification.permission !== "granted") {
              if ((await Notification.requestPermission()) !== "granted") return;
            }
            update({ notifyDesktop: !s.notifyDesktop });
          }}
        />
      </div>

      <Group title="Limits">
        <Field label="Max open" value={s.maxOpen} step={1} onChange={(v) => update({ maxOpen: Math.round(v) })} />
        <Field label="Max per hour" value={s.maxPerHour} step={1} onChange={(v) => update({ maxPerHour: Math.round(v) })} />
      </Group>

      <p className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-2">
        Runs while Kixo is open in this browser. Dev selling always blocks a buy. Settings and history stay in this browser
      </p>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted">{title}</p>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: () => void | Promise<void> }) {
  return (
    <label className="flex items-center justify-between text-sm text-text-2">
      {label}
      <input type="checkbox" checked={on} onChange={onChange} className="h-4 w-4 accent-emerald" />
    </label>
  );
}

function Stat({ label, value, sub, raw, tone = "text-text" }: { label: string; value: string; sub?: string; raw?: number | null; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-lg whitespace-nowrap sm:text-2xl ${tone}`}>
        <Tick value={raw}>{value}</Tick>
      </dd>
      {sub && <p className="mt-1 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

/** Realised profit after each closed snipe, with a zero line. */
function Equity({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="flex flex-1 items-center justify-center py-10 text-xs text-muted">The curve draws after two closed snipes</p>;
  const w = 600;
  const h = 140;
  const all = [0, ...points];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (all.length - 1)) * w;
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (h - 12);
  const d = all.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = points[points.length - 1] >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`mt-2 h-36 w-full ${up ? "text-positive" : "text-negative"}`} preserveAspectRatio="none" role="img" aria-label="Realised profit over time">
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />
      <path d={`${d}L${w},${y(0)}L0,${y(0)}Z`} fill="currentColor" opacity="0.08" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function equityCurve(closed: SnipePosition[]) {
  const sorted = [...closed].sort((a, b) => (a.exitTs ?? 0) - (b.exitTs ?? 0));
  const out: number[] = [];
  for (const p of sorted) out.push((out.at(-1) ?? 0) + (pnl(p, null).sol ?? 0));
  return out;
}

/** The same amount in dollars at the live SOL price, signed. */
function dollars(solAmount: number, solUsd: number | null) {
  if (!solUsd) return undefined;
  const v = solAmount * solUsd;
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
}

/** While nothing passes: how many launches the sniper checked and why it skipped them. */
function ScanStatus() {
  const scan = useSniperScan();
  if (!scan.checked) return <>Waiting for a launch that passes your rules</>;
  return (
    <span className="flex flex-col items-center gap-1">
      <span>
        Checked {scan.checked} new launch{scan.checked === 1 ? "" : "es"} in the last 10 minutes. None passes your rules right now
      </span>
      {scan.top.length > 0 && (
        <span className="text-xs text-muted">
          Most were skipped for: {scan.top.map(([r, n]) => `${r} (${n})`).join(", ")}. The Aggressive preset or looser rules buy more often
        </span>
      )}
    </span>
  );
}
