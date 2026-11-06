"use client";
import { TradeLink } from "@/components/token/trade-link";

import { Crosshair, Fish, Globe, Send, ShieldCheck, UserCog, Users, UsersRound, type LucideIcon } from "lucide-react";
import { usd, type MarketToken } from "@/lib/gateway";
import { CopyAddress, CopyMint, TokenLogo } from "@/components/token/token-bits";
import { useOpenToken } from "@/lib/open-token";
import { AiButton } from "@/components/token/ai-analysis";
import { inputFromLaunch } from "@/lib/ai";
import { formatAge, type RadarToken } from "./use-radar-feed";

/** Concentration above these levels is flagged. Facts, not advice. */
const TOP10_WARN = 30;
const DEV_WARN = 10;
const EARLY_WARN = 10;

/** One new coin on Sol Radar, dense like a trading terminal row:
 *  1. identity, volume and market cap
 *  2. age, socials, holders, trade count with buy/sell split, net buying
 *  3. holder-risk chips, curve progress and actions
 *  Colour only carries meaning: green buys and healthy shares, red sells and
 *  concentration worth checking, cyan for the curve.
 *  `alt`: provider figures, used when our engine has no USD price for the coin
 *  (other launchpads, or curves quoted in another currency). */
export function TokenCard({
  token,
  alt,
  now,
  repeated,
  lowerRisk,
}: {
  token: RadarToken;
  alt: MarketToken | null;
  now: number;
  repeated: boolean;
  lowerRisk: boolean;
}) {
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

  return (
    <article
      onClick={open(token.mint)}
      className={`flex cursor-pointer gap-3 rounded-xl border bg-surface p-3 transition-colors duration-150 hover:bg-surface-2 ${
        token.arrived ? "row-in" : ""
      } ${graduating || lowerRisk ? "border-emerald/40" : "border-border hover:border-[rgb(237_237_237/0.16)]"}`}
    >
      {/* Logo and contract address */}
      <div className="flex w-18 shrink-0 flex-col items-center gap-1.5">
        <TokenLogo src={meta?.image ?? null} symbol={token.symbol} size={72} />
        <span className="text-[11px]">
          <CopyMint mint={token.mint} />
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* 1. Identity, volume, market cap */}
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-base font-medium text-text">{token.symbol || "—"}</span>
            <span className="truncate text-sm text-muted">{token.name}</span>
          </div>
          <div className="flex shrink-0 items-baseline gap-3 font-mono">
            <span className="text-sm" title="Volume, last hour">
              <span className="text-muted">V </span>
              <span className="text-text">{usd(vol1h)}</span>
            </span>
            <span className="text-base" title="Market cap">
              <span className="text-xs text-muted">MC </span>
              <span className="text-cyan">{usd(mc)}</span>
            </span>
          </div>
        </div>

        <div className="-mt-1.5 text-[11px]">
          <CopyAddress value={token.creator} prefix="dev" title={`Copy creator wallet ${token.creator}`} className="text-muted" />
        </div>

        {/* 2. Age, socials, holders, trades, net buying */}
        <div className="flex min-w-0 items-center gap-3 font-mono text-xs">
          <span className={age < 60 ? "text-emerald" : "text-text-2"} title="Age">
            {formatAge(age)}
          </span>
          {(meta?.twitter || meta?.telegram || meta?.website) && (
            <span className="flex items-center">
              {meta?.twitter && <Social href={meta.twitter} label="X / Twitter"><XGlyph /></Social>}
              {meta?.telegram && <Social href={meta.telegram} label="Telegram"><Send size={13} strokeWidth={1.5} /></Social>}
              {meta?.website && <Social href={meta.website} label="Website"><Globe size={13} strokeWidth={1.5} /></Social>}
            </span>
          )}
          <span className="flex items-center gap-1 text-text-2" title={ownWallets ? "Holders, counted from trades since launch" : "Holders"}>
            <Users size={13} strokeWidth={1.5} className="text-muted" />
            {holders != null ? holders.toLocaleString() : "—"}
          </span>
          {netBuy != null && (
            <span className={netBuy >= 0 ? "text-positive" : "text-negative"} title="Net buying, last hour (bought minus sold)">
              <span className="text-muted">NB </span>
              {netBuy >= 0 ? "+" : "−"}
              {usd(Math.abs(netBuy))}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5" title={buys != null ? `Last hour: ${buys} buys, ${sells ?? 0} sells` : "Trades"}>
            <span className="text-muted">TX</span>
            <span className="text-text">{m ? m.trades_total.toLocaleString() : flow ? flow.toLocaleString() : "—"}</span>
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

        {/* 3. Holder-risk chips, curve, actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          {top10 != null && <Chip icon={UsersRound} value={`${top10.toFixed(0)}%`} warn={top10 >= TOP10_WARN} title="Share held by the 10 largest wallets" />}
          {ownWallets && <Chip icon={UserCog} label="Dev" value={`${m.dev_pct.toFixed(0)}%`} warn={m.dev_pct >= DEV_WARN} title="Share held by the creator wallet" />}
          {ownWallets && (
            <Chip
              icon={Crosshair}
              value={`${m.sniper_pct.toFixed(0)}%`}
              warn={m.sniper_pct >= EARLY_WARN}
              title={`Early buyers (first 3 seconds): ${m.snipers} wallets, share they still hold`}
            />
          )}
          {!!m?.whale_buys_1h && <Chip icon={Fish} value={String(m.whale_buys_1h)} tone="text-cyan" title="Buys of 5 SOL or more, last hour" />}
          {curve && m && (
            <span
              className={`flex h-6 items-center gap-1.5 rounded-full border border-border px-2 font-mono text-[11px] ${graduating || m.complete ? "text-emerald" : "text-text-2"}`}
              title={`Bonding curve ${m.curve_progress.toFixed(1)}%`}
            >
              <span className="h-1 w-8 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full bg-cyan" style={{ width: `${Math.max(2, m.curve_progress)}%` }} />
              </span>
              {m.complete ? "Graduated" : `${m.curve_progress.toFixed(0)}%`}
            </span>
          )}
          {lowerRisk && (
            <span className="flex h-6 items-center gap-1 rounded-full border border-emerald/30 px-2 text-[11px] text-emerald" title="Passed every new-launch red-flag check. Not a guarantee">
              <ShieldCheck size={12} strokeWidth={1.5} />
              Lower risk
            </span>
          )}
          {repeated && (
            <span className="flex h-6 items-center rounded-full border border-warning/30 px-2 text-[11px] text-warning" title="Another coin on the radar uses the same symbol">
              Copy of symbol
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <AiButton input={() => inputFromLaunch(token)} compact />
            <TradeLink mint={token.mint} />
          </span>
        </div>
      </div>
    </article>
  );
}

/** A small rounded figure. Holder shares read green under their warning level and red over it. */
function Chip({ icon: Icon, label, value, warn, tone, title }: { icon: LucideIcon; label?: string; value: string; warn?: boolean; tone?: string; title: string }) {
  const color = tone ?? (warn ? "text-negative border-negative/30" : "text-positive");
  return (
    <span className={`flex h-6 items-center gap-1 rounded-full border border-border px-2 font-mono text-[11px] ${color}`} title={title}>
      <Icon size={12} strokeWidth={1.5} />
      {label && <span className="font-sans">{label}</span>}
      {value}
    </span>
  );
}

function Social({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors hover:bg-surface-3 hover:text-text"
    >
      {children}
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
