"use client";
/* The coin, in one card on its trade page: banner, logo and name, the creator's own
   description, every link it has (from its launch data and its DexScreener profile), and
   the facts a trader checks before buying: contract, creator, age, where it trades, how
   many pools, and whether more tokens can be minted or wallets frozen. Links and images
   come from creators and are not checked by Kixo. */
import { useEffect, useState } from "react";
import { BadgeCheck, ExternalLink, Globe, Search, Send } from "lucide-react";
import { GATEWAY_HTTP, type FeedToken, type MarketToken } from "@/lib/gateway";
import type { DiscoverRow } from "@/lib/categories";
import { CopyMint, TokenLogo } from "@/components/token/token-bits";
import { WalletLink } from "@/components/tracker/wallet-tracker";
import { formatAge } from "@/components/radar/use-radar-feed";

type Profile = {
  header: string | null;
  image: string | null;
  websites: { label: string; url: string }[];
  socials: { type: string; url: string }[];
  dex: string | null;
  pair_url: string | null;
  pair_created_ms: number | null;
  pools: number;
} | null;

function useProfile(mint: string) {
  const [state, setState] = useState<{ mint: string; p: Profile }>({ mint, p: null });
  useEffect(() => {
    let alive = true;
    fetch(`${GATEWAY_HTTP}/token/${encodeURIComponent(mint)}/profile`)
      .then((r) => (r.ok ? (r.json() as Promise<Profile>) : null))
      .then((p) => alive && setState({ mint, p }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mint]);
  return state.mint === mint ? state.p : null;
}

const LAUNCHPAD: Record<string, string> = {
  "pump.fun": "pump.fun",
  "letsbonk.fun": "letsbonk",
  bags: "Bags",
  "met-dbc": "Meteora",
  "raydium-launchlab": "LaunchLab",
  moonshot: "Moonshot",
};

export function CoinProfile({ row: r, launch, market, now }: { row: DiscoverRow; launch: FeedToken | null; market: MarketToken | null; now: number }) {
  const p = useProfile(r.mint);
  const [more, setMore] = useState(false);
  const desc = launch?.meta?.description?.trim() || null;

  // Every link once: the launch's own, then the profile's.
  const links: { key: string; label: string; href: string; icon: React.ReactNode }[] = [];
  const seen = new Set<string>();
  const add = (label: string, href: string | null | undefined, icon: React.ReactNode) => {
    // One X and one Telegram (twitter.com and x.com links to the same account differ).
    const id = label === "X" || label === "Telegram" ? label : href?.replace(/\/$/, "");
    if (!href || !id || seen.has(id)) return;
    seen.add(id);
    links.push({ key: href, label, href, icon });
  };
  const x = <XGlyph />;
  add("X", r.twitter, x);
  add("Telegram", r.telegram, <Send size={12} strokeWidth={1.5} />);
  add(host(r.website) ?? "Website", r.website, <Globe size={12} strokeWidth={1.5} />);
  for (const s of p?.socials ?? []) add(s.type === "twitter" ? "X" : cap(s.type), s.url, s.type === "twitter" ? x : s.type === "telegram" ? <Send size={12} strokeWidth={1.5} /> : <ExternalLink size={12} strokeWidth={1.5} />);
  for (const w of p?.websites ?? []) add(host(w.url) ?? w.label, w.url, <Globe size={12} strokeWidth={1.5} />);

  const ageSecs = r.createdAt != null ? now / 1000 - r.createdAt : p?.pair_created_ms ? now / 1000 - p.pair_created_ms / 1000 : NaN;
  const where = launch ? (LAUNCHPAD[launch.launchpad] ?? launch.launchpad) : null;
  const m = launch?.market;
  const facts: [string, React.ReactNode][] = [
    ["Contract", <CopyMint key="c" mint={r.mint} />],
    ...(launch?.creator ? [["Creator", <WalletLink key="d" address={launch.creator} extra={["dev"]} badges={false} />] as [string, React.ReactNode]] : []),
    ["Age", Number.isFinite(ageSecs) ? formatAge(ageSecs) : "—"],
    ...(where ? [["Launched on", where] as [string, React.ReactNode]] : []),
    ...(p?.dex ? [["Trades on", `${cap(p.dex)}${p.pools > 1 ? ` · ${p.pools} pools` : ""}`] as [string, React.ReactNode]] : []),
    ...(m ? [["Bonding curve", m.complete ? "Graduated" : `${m.curve_progress.toFixed(1)}%`] as [string, React.ReactNode]] : []),
    ["Mint authority", market ? (market.mint_authority_disabled ? "Revoked" : <span key="ma" className="text-warning">Active</span>) : "—"],
    ["Freeze authority", market?.freeze_authority_disabled == null ? "—" : market.freeze_authority_disabled ? "Revoked" : <span key="fa" className="text-warning">Active</span>],
  ];

  const banner = p?.header ?? null;
  return (
    <section className="border-b border-border">
      {banner && (
        // Creator-hosted banner of unknown origin: no referrer, lazy.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-3/1 w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
      )}
      <div className="p-3">
        <div className={`flex items-center gap-2.5 ${banner ? "-mt-8" : ""}`}>
          <span className="rounded-lg ring-2 ring-surface">
            <TokenLogo src={r.image ?? p?.image ?? null} symbol={r.symbol} size={44} />
          </span>
          <div className={`min-w-0 ${banner ? "mt-6" : ""}`}>
            <p className="flex items-center gap-1.5 text-sm font-medium text-text">
              <span className="truncate">{r.symbol || "—"}</span>
              {r.verified && <BadgeCheck size={13} strokeWidth={1.5} className="shrink-0 text-cyan" aria-label="Verified" />}
            </p>
            <p className="truncate text-xs text-muted">{r.name}</p>
          </div>
        </div>

        {desc && (
          <p className={`mt-2.5 text-xs leading-5 wrap-break-word text-text-2 ${more ? "" : "line-clamp-3"}`}>
            {desc}
            {desc.length > 160 && (
              <button type="button" onClick={() => setMore((v) => !v)} className="ml-1 text-cyan hover:underline">
                {more ? "less" : "more"}
              </button>
            )}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {links.map((l) => (
            <a key={l.key} href={l.href} target="_blank" rel="noopener noreferrer nofollow" title={l.href} className="flex h-6 max-w-40 items-center gap-1 rounded-md border border-border bg-bg px-2 text-[11px] text-text-2 transition-colors hover:border-cyan/40 hover:text-cyan">
              {l.icon}
              <span className="truncate">{l.label}</span>
            </a>
          ))}
          <a href={`https://x.com/search?q=${encodeURIComponent(r.mint)}`} target="_blank" rel="noopener noreferrer nofollow" className="flex h-6 items-center gap-1 rounded-md border border-border bg-bg px-2 text-[11px] text-text-2 transition-colors hover:border-cyan/40 hover:text-cyan">
            <Search size={12} strokeWidth={1.5} /> Search X
          </a>
          {p?.pair_url && (
            <a href={p.pair_url} target="_blank" rel="noopener noreferrer nofollow" className="flex h-6 items-center gap-1 rounded-md border border-border bg-bg px-2 text-[11px] text-text-2 transition-colors hover:border-cyan/40 hover:text-cyan">
              <ExternalLink size={12} strokeWidth={1.5} /> DexScreener
            </a>
          )}
          <a href={`https://solscan.io/token/${r.mint}`} target="_blank" rel="noopener noreferrer nofollow" className="flex h-6 items-center gap-1 rounded-md border border-border bg-bg px-2 text-[11px] text-text-2 transition-colors hover:border-cyan/40 hover:text-cyan">
            <ExternalLink size={12} strokeWidth={1.5} /> Solscan
          </a>
        </div>
        {links.length === 0 && <p className="mt-1.5 text-[11px] text-muted">No website or social links</p>}

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10.5px] text-muted">{k}</dt>
              <dd className="truncate font-mono text-[11px] text-text">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[10px] leading-4 text-muted">Images, descriptions and links come from the coin&apos;s creator and are not checked by Kixo</p>
      </div>
    </section>
  );
}

function host(u: string | null | undefined) {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function XGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.9 2H22l-7.4 8.5L23 22h-6.8l-5.3-7-6.1 7H1.7l7.9-9.1L1 2h7l4.8 6.4L18.9 2Zm-1.2 18h1.9L7.4 4H5.4l12.3 16Z" />
    </svg>
  );
}
