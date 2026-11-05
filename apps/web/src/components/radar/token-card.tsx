"use client";

import { useState } from "react";
import { Check, Copy, Globe, Send } from "lucide-react";
import { price, shortAddress, usd, type Market } from "@/lib/gateway";
import { formatAge, type RadarToken } from "./use-radar-feed";

/** Concentration above these levels is flagged. Facts, not advice. */
const TOP10_WARN = 30;
const DEV_WARN = 10;

/** One token on Sol Radar. On-chain data from our own decoders, plus creator metadata. */
export function TokenCard({ token, now, repeated }: { token: RadarToken; now: number; repeated: boolean }) {
  const age = now / 1000 - token.timestamp;
  const meta = token.meta;
  const m = token.market;

  return (
    <article
      className={`h-full px-4 py-3 transition-colors duration-150 hover:bg-surface-2 ${
        token.arrived ? "row-in" : ""
      }`}
    >
      <div className="flex gap-3">
        <TokenLogo src={meta?.image ?? null} symbol={token.symbol} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[15px] font-medium text-text">{token.symbol || "—"}</span>
              <span className="truncate text-sm text-text-2">{token.name}</span>
            </div>
            <span className={`shrink-0 font-mono text-xs ${age < 60 ? "text-emerald" : "text-text-2"}`}>
              {formatAge(age)}
            </span>
          </div>

          <div className="mt-1 flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 text-xs text-muted">
              <CopyMint mint={token.mint} />
              <a
                href={`https://solscan.io/account/${token.creator}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Creator wallet on Solscan"
                className="font-mono transition-colors hover:text-text"
              >
                dev {shortAddress(token.creator)}
              </a>
            </div>
            {m && !m.sol_quoted ? (
              <span className="text-xs text-muted" title="This curve trades against a currency other than SOL">
                Non-SOL pair
              </span>
            ) : (
              <div className="text-right">
                <span className="text-xs text-muted">MC </span>
                <span className="font-mono text-sm text-text">{usd(m?.mc_usd)}</span>
              </div>
            )}
          </div>

          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="flex items-center gap-0.5">
              {meta?.twitter && <Social href={meta.twitter} label="X / Twitter"><XGlyph /></Social>}
              {meta?.telegram && <Social href={meta.telegram} label="Telegram"><Send size={14} strokeWidth={1.5} /></Social>}
              {meta?.website && <Social href={meta.website} label="Website"><Globe size={14} strokeWidth={1.5} /></Social>}
            </div>
            <div className="font-mono text-xs text-text-2">
              <span className="text-muted">V 1h </span>
              {usd(m?.volume_1h_usd)}
              <span className="px-1.5 text-muted">·</span>
              {price(m?.price_usd)}
            </div>
          </div>
        </div>
      </div>

      {m && <Metrics m={m} repeated={repeated} />}
    </article>
  );
}

function Metrics({ m, repeated }: { m: Market; repeated: boolean }) {
  const top10Hot = m.top10_pct >= TOP10_WARN;
  const devHot = m.dev_pct >= DEV_WARN;
  return (
    <div className="mt-3 pl-[68px]">
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" title={`Bonding curve ${m.curve_progress}%`}>
        <div
          className={`h-full rounded-full ${m.complete ? "bg-cyan" : "bg-emerald"}`}
          style={{ width: `${Math.max(2, m.curve_progress)}%` }}
        />
      </div>
      <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
        <Fact label="Curve" value={`${m.curve_progress.toFixed(0)}%`} />
        <Fact label="Holders" value={`~${m.holders}`} title="Approximate: counted from trades since launch" />
        <Fact label="Trades 1h" value={`${m.buys_1h}/${m.sells_1h}`} title="Buys / sells in the last hour" />
        {m.whale_trades_1h > 0 && (
          <Fact label="Whales" value={m.whale_trades_1h} title="Trades of 5 SOL or more in the last hour" />
        )}
        <Fact label="Top 10" value={`${m.top10_pct.toFixed(0)}%`} warn={top10Hot} />
        <Fact label="Dev" value={`${m.dev_pct.toFixed(0)}%`} warn={devHot} />
        {repeated && (
          <span className="font-sans text-warning" title="Another token in this feed uses the same symbol">
            Repeated symbol
          </span>
        )}
      </dl>
    </div>
  );
}

function Fact({ label, value, warn, title }: { label: string; value: string | number; warn?: boolean; title?: string }) {
  return (
    <div className="flex items-baseline gap-1" title={title}>
      <dt className="text-muted">{label}</dt>
      <dd className={warn ? "text-warning" : "text-text-2"}>{value}</dd>
    </div>
  );
}

function TokenLogo({ src, symbol }: { src: string | null; symbol: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (symbol.replace(/[^a-z0-9]/gi, "")[0] ?? "?").toUpperCase();

  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-3">
      {src && !failed ? (
        // Creator-hosted image of unknown origin: no referrer, lazy, sized box.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-mono text-lg text-muted">{letter}</span>
      )}
    </div>
  );
}

function CopyMint({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy mint address ${mint}`}
      onClick={() =>
        navigator.clipboard.writeText(mint).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        })
      }
      className="-mx-1 flex items-center gap-1 rounded px-1 font-mono text-cyan transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-emerald"
    >
      {shortAddress(mint)}
      {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
    </button>
  );
}

function Social({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={label}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-text"
    >
      {children}
    </a>
  );
}

function XGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.72H5.58l11.1 14.48Z" />
    </svg>
  );
}
