"use client";
import { memo } from "react";
import { TradeLink } from "@/components/token/trade-link";
import { QuickBuy } from "@/components/trade/quick-buy";

import { useRadarFilters } from "@/lib/prefs";
import { ArrowUpRight, EyeOff, Brain, History, Fish, Globe, Send, TrendingDown, Users, type LucideIcon } from "lucide-react";
import { StarButton } from "@/components/token/star-button";
import type { Check } from "@/lib/risk";
import { launchSignals, safetyScore } from "@/lib/safety";
import { SafetyBadge } from "@/components/token/safety-badge";
import { ChecksChip } from "./checks-popover";
import type { Original } from "./radar-board";
import { usd, type DevReport, type MarketToken } from "@/lib/gateway";
import { CopyAddress, CopyMint, TokenLogo } from "@/components/token/token-bits";
import { tokenHref, useOpenToken } from "@/lib/open-token";
import Link from "next/link";
import { AiButton } from "@/components/token/ai-analysis";
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
  if (smart > 0) flags.push({ key: "smart", tone: "info", icon: Brain, text: `${smart} smart wallet${smart === 1 ? "" : "s"}`, title: "Smart wallets hold this coin: profitable on 3+ coins at a human pace" });
  if (m?.whale_buys_1h) flags.push({ key: "whale", tone: "info", icon: Fish, text: `${m.whale_buys_1h} whale buy${m.whale_buys_1h === 1 ? "" : "s"}`, title: "Buys of 5 SOL or more, last hour" });
  if (d && d.rugged === 0 && d.graduated > 0) flags.push({ key: "grad", tone: "good", icon: History, text: `Dev graduated ${d.graduated}/${d.coins}`, title: devTitle(d) });
  if (xShare?.kind === "post") flags.push({ key: "trend", tone: "muted", glyph: true, text: `Trend · ${xShare.others + 1} coins`, title: `${xShare.others + 1} new coins link this same X post: one trend. Not a red flag by itself` });
  if (d && d.coins === 0) flags.push({ key: "new-dev", tone: "muted", icon: History, text: "New dev", title: devTitle(d) });
  const shown = flags.slice(0, 2);
  const folded = flags.slice(2);

  return (
    <article
      onClick={open(token.mint)}
      className={`flex h-full cursor-pointer flex-col gap-2.5 rounded-xl border bg-surface p-3 transition-colors duration-150 hover:bg-surface-2 ${
        token.arrived ? "row-in" : ""
      } ${graduating || lowerRisk ? "border-emerald/40" : "border-border hover:border-[rgb(237_237_237/0.16)]"}`}
    >
      {/* Identity and the two numbers people read first */}
      <div className="flex gap-3">
        <TokenLogo src={meta?.image ?? null} symbol={token.symbol} size={56} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="max-w-[60%] shrink-0 truncate text-base font-medium text-text" title={token.symbol}>
                {token.symbol || "—"}
              </span>
              <span className="min-w-0 truncate text-sm text-muted" title={token.name}>
                {token.name}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2.5">
              <SafetyBadge safety={safety} />
              <span className="font-mono text-base text-cyan" title="Market cap">
                {usd(mc)}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-center gap-1">
              <CopyAddress value={token.creator} prefix="dev" title={`Copy creator wallet ${token.creator}`} className="text-muted" />
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
            <span className="shrink-0 font-mono text-text-2" title="Volume, last hour">
              <span className="text-muted">Vol </span>
              {usd(vol1h)}
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className={age < 60 ? "text-emerald" : "text-text-2"} title="Age">
              {formatAge(age)}
            </span>
            <span className="flex items-center gap-1 text-text-2" title={ownWallets ? "Holders, counted from trades since launch" : "Holders"}>
              <Users size={12} strokeWidth={1.5} className="text-muted" />
              {holders != null ? holders.toLocaleString() : "—"}
              {ownWallets && m.holders_change_1h !== 0 && (
                <span className={m.holders_change_1h > 0 ? "text-positive" : "text-negative"} title="Holder change, last hour">
                  {m.holders_change_1h > 0 ? "+" : ""}
                  {m.holders_change_1h}
                </span>
              )}
            </span>
            {netBuy != null && (
              <span className={netBuy >= 0 ? "text-positive" : "text-negative"} title="Net buying, last hour (bought minus sold)">
                <span className="text-muted">NB </span>
                {netBuy >= 0 ? "+" : "−"}
                {usd(Math.abs(netBuy))}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5" title={buys != null ? `Last hour: ${buys} buys, ${sells ?? 0} sells` : "Trades"}>
              <span className="text-text">{m ? m.trades_total.toLocaleString() : flow ? flow.toLocaleString() : "—"}</span>
              <span className="text-muted">tx</span>
              <span className="flex h-1 w-10 overflow-hidden rounded-full bg-surface-3">
                {flow > 0 && (
                  <>
                    <span className="h-full bg-positive" style={{ width: `${((buys ?? 0) / flow) * 100}%` }} />
                    <span className="h-full bg-negative" style={{ width: `${((sells ?? 0) / flow) * 100}%` }} />
                  </>
                )}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Holder shares and the curve: always the same five cells */}
      <dl className="grid grid-cols-5 gap-1 rounded-lg border border-border bg-bg/40 px-2 py-1.5">
        <Cell label="Top 10" value={top10} warn={TOP10_WARN} title="Share held by the 10 largest wallets" />
        <Cell label="Dev" value={ownWallets ? m.dev_pct : null} warn={DEV_WARN} title="Share held by the creator wallet" />
        <Cell label="Early" value={ownWallets ? m.sniper_pct : null} warn={EARLY_WARN} title={ownWallets ? `${m.snipers} wallets bought in the first 3 seconds; share they still hold` : "Early buyers"} />
        <Cell label="Bundles" value={ownWallets ? m.bundle_pct : null} warn={BUNDLE_WARN} title={ownWallets ? `${m.bundled} wallets bought together in one slot after launch; share they still hold` : "Bundles"} />
        <div className="min-w-0" title={m && curve ? `Bonding curve ${m.curve_progress.toFixed(1)}%` : "No curve"}>
          <dt className="text-[10px] text-muted">{m?.complete ? "Graduated" : "Curve"}</dt>
          <dd className={`flex items-center gap-1 font-mono text-[11px] ${graduating || m?.complete ? "text-emerald" : "text-text-2"}`}>
            {curve && m ? (
              <>
                <span className="h-1 w-full max-w-8 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full bg-cyan" style={{ width: `${Math.max(2, m.curve_progress)}%` }} />
                </span>
                {m.curve_progress.toFixed(0)}%
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      {/* Social links: always three slots, lit when the coin has the link */}
      <div className="grid grid-cols-3 gap-1.5">
        <SocialLink href={meta?.twitter} label="X" icon={<XGlyph />} />
        <SocialLink href={meta?.telegram} label="Telegram" icon={<Send size={12} strokeWidth={1.5} />} />
        <SocialLink href={meta?.website} label="Website" icon={<Globe size={12} strokeWidth={1.5} />} />
      </div>

      {/* Two flags at most, the rest folded */}
      <div className="flex h-6 items-center gap-1.5 overflow-hidden">
        {shown.map((f) => (
          <FlagChip key={f.key} flag={f} />
        ))}
        {folded.length > 0 && (
          <span className="flex h-6 shrink-0 items-center rounded-full border border-border px-2 font-mono text-[11px] text-text-2" title={folded.map((f) => f.text).join(" · ")}>
            +{folded.length}
          </span>
        )}
        {flags.length === 0 && <span className="text-[11px] text-muted">No warning signs in the data so far</span>}
      </div>

      {/* Footer, pinned to the bottom of every card */}
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-2.5">
        {checks.length > 0 && <ChecksChip checks={checks} listed={lowerRisk} score={safety.score} />}
        <span className="text-[11px]">
          <CopyMint mint={token.mint} />
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <AiButton input={() => inputFromLaunch(token)} safety={safety} compact />
          <QuickBuy mint={token.mint} symbol={token.symbol} />
          <TradeLink mint={token.mint} />
        </span>
      </div>
    </article>
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
  const cls = `flex h-6 min-w-0 shrink items-center gap-1 rounded-full border px-2 text-[11px] ${FLAG_TONE[f.tone]}`;
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

/** One holder-share cell: green under its warning level, red over it, dash if unknown. */
function Cell({ label, value, warn, title }: { label: string; value: number | null; warn: number; title: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className={`font-mono text-[11px] ${value == null ? "text-muted" : value >= warn ? "text-negative" : "text-positive"}`}>{value == null ? "—" : `${value.toFixed(0)}%`}</dd>
    </div>
  );
}

function devTitle(r: DevReport) {
  return r.coins === 0
    ? "No earlier coins by this creator since Kixo started tracking"
    : `Creator's earlier coins: ${r.coins} launched, ${r.graduated} graduated, ${r.rugged} rugged (sold out, down 70%+), ${r.died_fast} died within 15 minutes${
        r.best_peak_mc_usd ? `, best peak ${usd(r.best_peak_mc_usd)}` : ""
      }`;
}

/** One social link slot. With a link it opens it in a new tab; without, it stays dim
 *  and says so, so a missing link is as visible as a present one. Metadata is still
 *  loading when `meta` has not arrived yet. */
function SocialLink({ href, label, icon }: { href: string | null | undefined; label: string; icon: React.ReactNode }) {
  if (!href) {
    return (
      <span className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-[11px] text-muted/60" title={`No ${label} link`}>
        {icon}
        {label}
      </span>
    );
  }
  let host = "";
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    // Shown without the host.
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      title={`${label}: ${href}`}
      className="flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-[11px] text-text transition-colors hover:border-cyan/40 hover:text-cyan"
    >
      {icon}
      <span className="truncate">{label === "Website" && host ? host : label}</span>
    </a>
  );
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
