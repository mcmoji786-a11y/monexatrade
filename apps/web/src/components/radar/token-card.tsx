"use client";
import { memo, useState } from "react";
import { useCoinKols } from "@/lib/kols";
import { useFeatures } from "@/lib/features";
import { QuickBuy } from "@/components/trade/quick-buy";

import { useRadarFilters } from "@/lib/prefs";
import { ArrowUpRight, BadgeCheck, Boxes, Check as CheckIcon, Copy, Crosshair, EyeOff, Brain, History, Fish, Globe, Search, Send, TrendingDown, UserCog, Users, type LucideIcon } from "lucide-react";
import { StarButton } from "@/components/token/star-button";
import type { Check } from "@/lib/risk";
import { launchSignals, safetyScore } from "@/lib/safety";
import { SafetyBadge } from "@/components/token/safety-badge";
import { ChecksChip } from "./checks-popover";
import type { Original } from "./radar-board";
import { usd, type DevReport, type MarketToken } from "@/lib/gateway";
import { TokenLogo } from "@/components/token/token-bits";
import { tokenHref, useOpenToken } from "@/lib/open-token";
import Link from "next/link";
import { AiButton } from "@/components/token/ai-analysis";
import { AiRiskChip } from "@/components/token/ai-risk-chip";
import { inputFromLaunch } from "@/lib/ai";
import { formatAge, type RadarToken } from "./use-radar-feed";

/** Concentration above these levels is flagged. Facts, not advice. */
const TOP10_WARN = 30;
const DEV_WARN = 10;
const EARLY_WARN = 10;
const BUNDLE_WARN = 20;

/** One new coin on Sol Radar, dense like a trading terminal row:
 *  1. identity, volume and market cap
 *  2. age, socials, holders, trade count with buy/sell split, net buying
 *  3. holder-risk chips, curve progress and actions
 *  Colour only carries meaning: green buys and healthy shares, red sells and
 *  concentration worth checking, cyan for the curve.
 *  `alt`: provider figures, used when our engine has no USD price for the coin
 *  (other launchpads, or curves quoted in another currency). */
export const TokenCard = memo(TokenCardView, sameCard);

function TokenCardView({
  token,
  alt,
  now,
  repeated,
  checks,
  lowerRisk,
  original,
  sameSymbol,
  smart,
  xShare,
}: {
  token: RadarToken;
  alt: MarketToken | null;
  now: number;
  repeated: boolean;
  /** Every lower-risk check with its result (risk.ts). */
  checks: Check[];
  /** On the lower-risk list now, including the 3-minute hold (risk.ts lowerRiskNow). */
  lowerRisk: boolean;
  /** An established or verified coin with the same symbol (radar-board.tsx). */
  original: Original | null;
  /** Other new coins on the radar with the same symbol. */
  sameSymbol: number;
  /** Smart wallets holding this coin (gateway devs.rs). */
  smart: number;
  /** Other coins on the radar linking the same X account, or the same post/community. */
  xShare: { others: number; kind: "account" | "post" } | null;
}) {
  const { blockDev } = useRadarFilters();
  const kols = useCoinKols(token.mint);
  const feat = useFeatures();
  const open = useOpenToken();
  const age = now / 1000 - token.timestamp;
  const meta = token.meta;
  const m = token.market;
  // Curves whose progress our engine decodes. LaunchLab logs no trader, so its holder
  // figures come from the provider.
  const curve = token.launchpad === "pump.fun" || token.launchpad === "letsbonk.fun" || token.launchpad === "raydium-launchlab";
  const ownWallets = !!m && token.launchpad !== "letsbonk.fun" && token.launchpad !== "raydium-launchlab";
  const own = m?.sol_quoted ? m : null;
  const graduating = !!m && !m.complete && m.curve_progress >= 85;

  const mc = own?.mc_usd ?? alt?.mc_usd ?? null;
  const vol1h = own?.volume_1h_usd ?? alt?.volume_1h_usd ?? null;
  const holders = ownWallets ? m.holders : alt?.holders ?? null;
  const buys = m?.buys_1h ?? alt?.buys_1h ?? null;
  const sells = m?.sells_1h ?? alt?.sells_1h ?? null;
  const flow = (buys ?? 0) + (sells ?? 0);
  // Net buying in USD, at the same SOL price the volume was converted with.
  const usdPerSol = own && own.volume_1h_sol > 0 && own.volume_1h_usd ? own.volume_1h_usd / own.volume_1h_sol : null;
  const netBuy = own && usdPerSol ? own.net_buy_1h_sol * usdPerSol : null;
  const top10 = ownWallets ? m.top10_pct : alt?.top_holders_pct ?? null;
  const safety = safetyScore(
    launchSignals(token, alt, {
      copyOfReal: !!original,
      sameSymbol: repeated && !original,
      sameXAccount: xShare?.kind === "account",
      smart,
      nowSecs: now / 1000,
    }),
  );

  // Flags, most important first. A card shows two and folds the rest into "+N", so
  // every card keeps the same height and nothing wraps.
  const flags: Flag[] = [];
  if (m?.dev_sold_all) flags.push({ key: "dev-out", tone: "bad", icon: TrendingDown, text: "Dev sold out", title: "The creator sold everything it bought" });
  else if (m && m.dev_sells > 0) flags.push({ key: "dev-sell", tone: "bad", icon: TrendingDown, text: "Dev selling", title: `The creator has sold ${m.dev_sells} times` });
  const d = token.dev_report;
  if (d && d.rugged > 0) flags.push({ key: "rug", tone: "bad", icon: History, text: `Dev rugged ${d.rugged}/${d.coins}`, title: devTitle(d) });
  else if (d && d.coins >= 3 && d.died_fast >= d.coins * 0.8)
    flags.push({ key: "died", tone: "warn", icon: History, text: `Dev's ${d.coins} coins died fast`, title: devTitle(d) });
  if (original)
    flags.push({
      key: "copy",
      tone: "warn",
      icon: ArrowUpRight,
      text: `Copy of ${original.verified ? "verified" : "established"} ${original.symbol}`,
      title: `Likely a copy: ${original.symbol} already exists (${original.mint}). Click to open the original`,
      href: tokenHref(original.mint),
    });
  if (xShare?.kind === "account") flags.push({ key: "x-acc", tone: "warn", glyph: true, text: `Same X account · ${xShare.others + 1}`, title: `${xShare.others + 1} new coins claim the same X account. A project has one coin; copies often borrow a real account` });
  if (!original && repeated) flags.push({ key: "sym", tone: "warn", text: `Same symbol · ${sameSymbol + 1}`, title: "Other new coins use this symbol too. None is verified or established, so none is confirmed as the original" });
  if (feat.kol_tracker && kols.length > 0) flags.push({ key: "kol", tone: "info", icon: BadgeCheck, text: `${kols.length} KOL${kols.length === 1 ? "" : "s"} bought`, title: `Bought in the last 24 hours by ${kols.map((k) => (k.x ? `${k.name} (@${k.x})` : k.name)).join(", ")}` });
  if (smart > 0) flags.push({ key: "smart", tone: "info", icon: Brain, text: `${smart} smart wallet${smart === 1 ? "" : "s"}`, title: "Smart wallets hold this coin: profitable on 3+ coins at a human pace" });
  if (m?.whale_buys_1h) flags.push({ key: "whale", tone: "info", icon: Fish, text: `${m.whale_buys_1h} whale buy${m.whale_buys_1h === 1 ? "" : "s"}`, title: "Buys of 5 SOL or more, last hour" });
  if (d && d.rugged === 0 && d.graduated > 0) flags.push({ key: "grad", tone: "good", icon: History, text: `Dev graduated ${d.graduated}/${d.coins}`, title: devTitle(d) });
  if (xShare?.kind === "post") flags.push({ key: "trend", tone: "muted", glyph: true, text: `Trend · ${xShare.others + 1} coins`, title: `${xShare.others + 1} new coins link this same X post: one trend. Not a red flag by itself` });
  if (d && d.coins === 0) flags.push({ key: "new-dev", tone: "muted", icon: History, text: "New dev", title: devTitle(d) });
  const shown = flags.slice(0, 1);

  const pctTone = (v: number | null, warn: number) => (v == null ? "text-muted" : v >= warn ? "text-negative" : "text-positive");
  const pctText = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
  const devPct = ownWallets ? m.dev_pct : null;
  const earlyPct = ownWallets ? m.sniper_pct : null;
  const bundlePct = ownWallets ? m.bundle_pct : null;

  return (
    <article
      onClick={open(token.mint)}
      className={`group flex h-full cursor-pointer gap-3 rounded-lg border bg-surface p-2.5 transition-colors duration-150 hover:bg-surface-2 ${token.arrived ? "row-in" : ""} ${
        graduating || lowerRisk ? "border-emerald/40" : "border-border hover:border-[rgb(237_237_237/0.16)]"
      }`}
    >
      {/* Logo with the bonding curve under it */}
      <div className="flex shrink-0 flex-col gap-1" title={m && curve ? `${m.complete ? "Graduated" : "Bonding curve"} ${m.curve_progress.toFixed(1)}%` : undefined}>
        <TokenLogo src={meta?.image ?? null} symbol={token.symbol} size={68} />
        <span className="h-1 w-[68px] overflow-hidden rounded-full bg-surface-3">
          {curve && m && <span className={`block h-full ${graduating || m.complete ? "bg-emerald" : "bg-cyan"}`} style={{ width: `${Math.max(2, Math.min(100, m.curve_progress))}%` }} />}
        </span>
      </div>

      {/* Middle: name, then age and links, then holder shares and flags */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="max-w-[55%] shrink-0 truncate text-sm font-medium text-text" title={token.symbol}>
            {token.symbol || "—"}
          </span>
          <span className="min-w-0 truncate text-xs text-muted" title={token.name}>
            {token.name}
          </span>
          <CopyIcon value={token.mint} />
        </div>

        <div className="flex min-w-0 items-center gap-2.5 text-xs">
          <span className={`font-mono ${age < 60 ? "text-emerald" : age < 600 ? "text-text" : "text-warning"}`} title="Age">
            {formatAge(age)}
          </span>
          <span className="flex items-center gap-1.5">
            {meta?.twitter && <IconLink href={meta.twitter} label="X"><XGlyph /></IconLink>}
            {meta?.telegram && <IconLink href={meta.telegram} label="Telegram"><Send size={13} strokeWidth={1.5} /></IconLink>}
            {meta?.website && <IconLink href={meta.website} label="Website"><Globe size={13} strokeWidth={1.5} /></IconLink>}
            <IconLink href={`https://x.com/search?q=${encodeURIComponent(token.mint)}`} label="Search this coin on X"><Search size={13} strokeWidth={1.5} /></IconLink>
          </span>
          <span className="flex items-center gap-1 font-mono text-text-2" title={ownWallets ? "Holders, counted from trades since launch" : "Holders"}>
            <Users size={13} strokeWidth={1.5} className="text-muted" />
            {holders != null ? holders.toLocaleString() : "—"}
          </span>
          {netBuy != null && Math.abs(netBuy) >= 1 && (
            <span className={`hidden font-mono sm:inline ${netBuy >= 0 ? "text-positive" : "text-negative"}`} title="Net buying, last hour (bought minus sold)">
              {netBuy >= 0 ? "+" : "−"}
              {usd(Math.abs(netBuy))}
            </span>
          )}
          <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                blockDev(token.creator);
              }}
              title="Hide every coin from this creator (undo in Filters)"
              aria-label="Hide this creator's coins"
              className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors hover:bg-surface-3 hover:text-negative"
            >
              <EyeOff size={12} strokeWidth={1.5} />
            </button>
            <StarButton mint={token.mint} size={12} />
          </span>
        </div>

        <div className="flex h-6 min-w-0 items-center gap-1 overflow-hidden">
          <Pct icon={Users} tone={pctTone(top10, TOP10_WARN)} text={pctText(top10)} title="Top 10 holders' share" />
          <Pct icon={UserCog} tone={pctTone(devPct, DEV_WARN)} text={pctText(devPct)} title="Creator's share" />
          <Pct icon={Crosshair} tone={pctTone(earlyPct, EARLY_WARN)} text={pctText(earlyPct)} title={ownWallets ? `Early buyers: ${m.snipers} wallets bought in the first 3 seconds; share they still hold` : "Early buyers"} />
          <Pct icon={Boxes} tone={pctTone(bundlePct, BUNDLE_WARN)} text={pctText(bundlePct)} title={ownWallets ? `Bundles: ${m.bundled} wallets bought together in one slot after launch; share they still hold` : "Bundles"} />
          {shown.map((f) => (
            <FlagChip key={f.key} flag={f} />
          ))}
          {flags.length > 1 && (
            <span className="flex h-5 shrink-0 items-center rounded-full border border-border px-1.5 font-mono text-[10px] text-text-2" title={flags.slice(1).map((f) => f.text).join(" · ")}>
              +{flags.length - 1}
            </span>
          )}
          {flags.length === 0 && <AiRiskChip mint={token.mint} ageSecs={age} />}
        </div>
      </div>

      {/* Right: volume and market cap, trades, actions */}
      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        <div className="flex items-baseline gap-2 font-mono">
          <span className="text-xs text-text-2" title="Volume, last hour">
            <span className="font-sans text-[10px] text-muted">V </span>
            {usd(vol1h)}
          </span>
          <span className="text-[15px] leading-5 text-cyan" title="Market cap">
            <span className="font-sans text-[10px] text-muted">MC </span>
            {usd(mc)}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          {checks.length > 0 && <ChecksChip checks={checks} listed={lowerRisk} score={safety.score} />}
          <SafetyBadge safety={safety} />
          <span className="flex items-center gap-1.5" title={buys != null ? `Last hour: ${buys} buys, ${sells ?? 0} sells` : "Trades"}>
            <span className="font-sans text-[10px] text-muted">TX</span>
            <span className="text-text">{m ? m.trades_total.toLocaleString() : flow ? flow.toLocaleString() : "—"}</span>
            <span className="flex h-0.5 w-8 overflow-hidden rounded-full bg-surface-3">
              {flow > 0 && (
                <>
                  <span className="h-full bg-positive" style={{ width: `${((buys ?? 0) / flow) * 100}%` }} />
                  <span className="h-full bg-negative" style={{ width: `${((sells ?? 0) / flow) * 100}%` }} />
                </>
              )}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <AiButton input={() => inputFromLaunch(token)} safety={safety} compact />
          <QuickBuy mint={token.mint} symbol={token.symbol} className="px-2.5 text-xs" />
        </div>
      </div>
    </article>
  );
}

/** One holder-share chip: green under its warning level, red over it, dim if unknown. */
function Pct({ icon: Icon, tone, text, title }: { icon: LucideIcon; tone: string; text: string; title: string }) {
  return (
    <span title={title} className={`flex h-5 shrink-0 items-center gap-1 rounded-full border border-border bg-bg/40 px-1.5 font-mono text-[10px] ${tone}`}>
      <Icon size={11} strokeWidth={1.5} />
      {text}
    </span>
  );
}

function CopyIcon({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy contract address ${value}`}
      aria-label="Copy contract address"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-3 hover:text-text"
    >
      {copied ? <CheckIcon size={12} strokeWidth={1.5} className="text-positive" /> : <Copy size={12} strokeWidth={1.5} />}
    </button>
  );
}

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      title={label === "Search this coin on X" ? label : `${label}: ${href}`}
      aria-label={label}
      className="text-muted transition-colors hover:text-cyan"
    >
      {children}
    </a>
  );
}

type Flag = { key: string; tone: "bad" | "warn" | "info" | "good" | "muted"; text: string; title: string; icon?: LucideIcon; glyph?: boolean; href?: string };
const FLAG_TONE: Record<Flag["tone"], string> = {
  bad: "border-negative/40 bg-negative/10 text-negative",
  warn: "border-warning/30 text-warning",
  info: "border-cyan/30 text-cyan",
  good: "border-positive/30 text-positive",
  muted: "border-border text-text-2",
};

function FlagChip({ flag: f }: { flag: Flag }) {
  const Icon = f.icon;
  const body = (
    <>
      {f.glyph ? <XGlyph /> : Icon ? <Icon size={12} strokeWidth={1.5} /> : null}
      <span className="truncate">{f.text}</span>
    </>
  );
  const cls = `flex h-5 max-w-44 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] whitespace-nowrap ${FLAG_TONE[f.tone]}`;
  return f.href ? (
    <Link href={f.href} onClick={(e) => e.stopPropagation()} title={f.title} className={`${cls} transition-colors hover:brightness-125`}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={f.title}>
      {body}
    </span>
  );
}

function devTitle(r: DevReport) {
  return r.coins === 0
    ? "No earlier coins by this creator since Kixo started tracking"
    : `Creator's earlier coins: ${r.coins} launched, ${r.graduated} graduated, ${r.rugged} rugged (sold out, down 70%+), ${r.died_fast} died within 15 minutes${
        r.best_peak_mc_usd ? `, best peak ${usd(r.best_peak_mc_usd)}` : ""
      }`;
}

function XGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.72H5.58l11.1 14.48Z" />
    </svg>
  );
}


type CardProps = Parameters<typeof TokenCardView>[0];

/** Cards re-render only when something they show changed. The clock ticks every
 *  second, but a coin's age only needs that while it is under a minute old; after
 *  that, every 10 seconds is enough. Hundreds of cards stay smooth this way. */
function sameCard(a: CardProps, b: CardProps) {
  const age = b.now / 1000 - b.token.timestamp;
  const clock = age < 60 ? a.now === b.now : Math.floor(a.now / 10_000) === Math.floor(b.now / 10_000);
  const checks = (c: Check[]) => c.map((x) => (x.ok ? 1 : 0)).join("");
  return (
    clock &&
    a.token === b.token &&
    a.alt === b.alt &&
    a.repeated === b.repeated &&
    a.lowerRisk === b.lowerRisk &&
    a.smart === b.smart &&
    a.sameSymbol === b.sameSymbol &&
    a.original?.mint === b.original?.mint &&
    a.xShare?.kind === b.xShare?.kind &&
    a.xShare?.others === b.xShare?.others &&
    checks(a.checks) === checks(b.checks)
  );
}
