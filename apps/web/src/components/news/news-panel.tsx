"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, GripHorizontal, PanelRight, PictureInPicture2, Play, Search, X } from "lucide-react";
import { useFeatures } from "@/lib/features";
import { GATEWAY_HTTP } from "@/lib/gateway";
import { NEWS_FILTERS, newsAgo, newsMatches, setNewsOpen, toggleNews, useNews, type NewsItem } from "@/lib/news";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

/** Pictures come through the gateway's image proxy (public https hosts only, cached). */
const proxied = (u: string) => `${GATEWAY_HTTP}/img?u=${encodeURIComponent(u)}`;

/** The news feed: live stories with search and filters. Used by the side panel and /news. */
export function NewsFeed({ onClose }: { onClose?: () => void }) {
  const { items, status } = useNews();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  // The clock is read after mount (never while prerendering), then every 30 s.
  const [now, setNow] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [newAbove, setNewAbove] = useState(0);
  // The story at the top when the reader scrolled down.
  const [anchor, setAnchor] = useState<string | null>(null);

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const test = NEWS_FILTERS.find((f) => f.key === filter)!.test;
  const shown = items.filter((i) => test(i) && newsMatches(i, query));
  const counts = Object.fromEntries(NEWS_FILTERS.map((f) => [f.key, items.filter(f.test).length]));

  // While the reader is down the list, new stories wait behind a "n new" button
  // instead of pushing what they are reading.
  const first = shown[0]?.id ?? null;
  const [prevFirst, setPrevFirst] = useState(first);
  if (first !== prevFirst) {
    setPrevFirst(first);
    if (scrolled && anchor) {
      const i = shown.findIndex((x) => x.id === anchor);
      setNewAbove(i > 0 ? i : 0);
    }
  }
  const toTop = () => {
    list.current?.scrollTo({ top: 0 });
    setNewAbove(0);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="text-sm font-medium text-text">News</h2>
        <span className={`flex items-center gap-1.5 text-[11px] ${status === "live" ? "text-text-2" : "text-muted"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "live-ring bg-emerald" : "bg-muted"}`} />
          {status === "live" ? "Live" : status === "offline" ? "Reconnecting" : "Connecting"}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted">{items.length ? `${items.length} stories` : ""}</span>
        {onClose && (
          <>
            <kbd className="hidden rounded border border-border bg-bg px-1.5 font-mono text-[10px] leading-4 text-muted lg:block">N</kbd>
            <button type="button" onClick={onClose} aria-label="Close news" className="-mr-1 flex size-8 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text">
              <X size={16} strokeWidth={1.5} />
            </button>
          </>
        )}
      </header>

      <div className="shrink-0 border-b border-border px-3 pt-3 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-bg px-3 focus-within:border-emerald/50">
          <Search size={14} strokeWidth={1.5} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => (setQuery(e.target.value), toTop())}
            placeholder="Search news, coins or sources"
            aria-label="Search news"
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted hover:text-text">
              <X size={14} strokeWidth={1.5} />
            </button>
          )}
        </label>
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter news">
          {NEWS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => (setFilter(f.key), toTop())}
              className={`flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs transition-colors ${filter === f.key ? "bg-surface-3 text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
            >
              {f.label}
              {f.key !== "all" && counts[f.key] > 0 && <span className="font-mono text-[10px] text-muted">{counts[f.key]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {newAbove > 0 && (
          <button
            type="button"
            onClick={() => (list.current?.scrollTo({ top: 0, behavior: "smooth" }), setNewAbove(0))}
            className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface-3 px-3 py-1 text-xs text-text shadow-lg shadow-black/40"
          >
            <ArrowUp size={12} strokeWidth={1.5} />
            {newAbove} new
          </button>
        )}
        <ol
          ref={list}
          onScroll={(e) => {
            const down = e.currentTarget.scrollTop > 80;
            if (down !== scrolled) {
              setScrolled(down);
              setAnchor(down ? (shown[0]?.id ?? null) : null);
              if (!down) setNewAbove(0);
            }
          }}
          className="h-full overflow-y-auto"
        >
          {shown.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-muted">
              {query ? `Nothing matches “${query}”` : status === "live" ? (items.length ? "Nothing in this filter yet" : "Gathering the latest stories") : "Connecting to the news feed"}
            </li>
          )}
          {shown.map((it) => (
            <li key={it.id} className="border-b border-border">
              <Story it={it} now={now} />
            </li>
          ))}
        </ol>
      </div>

      <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] leading-4 text-muted">Stories link to their original source and are not checked by Kixo. Not financial advice</p>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { onchain: "On-chain", community: "Community", x: "X", video: "Video" };

const ALERT: Record<string, { label: string; tone: string }> = {
  rising: { label: "New coin", tone: "text-emerald" },
  million: { label: "Milestone", tone: "text-emerald" },
  graduated: { label: "Graduated", tone: "text-cyan" },
  whale: { label: "Whale buy", tone: "text-cyan" },
  dev_out: { label: "Dev sold out", tone: "text-negative" },
  pump: { label: "Pumping", tone: "text-emerald" },
  trending: { label: "Trending", tone: "text-cyan" },
  sniped: { label: "Sniped at launch", tone: "text-warning" },
};

/** On a phone the panel covers the page, so opening a coin closes it. */
const closeOnPhone = () => {
  if (window.matchMedia("(max-width: 1023px)").matches) setNewsOpen(false);
};

/** An alert from Kixo's own engine: the coin, its numbers and a way to trade it. */
function Alert({ it, now }: { it: NewsItem; now: number }) {
  const [imgOk, setImgOk] = useState(true);
  const a = ALERT[it.alert ?? ""] ?? { label: "On-chain", tone: "text-emerald" };
  const coin = it.coins[0];
  const fresh = now > 0 && now / 1000 - it.ts < 600;
  return (
    <div className="px-4 py-3">
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
        {fresh && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" aria-label="Just in" />}
        <span className={a.tone}>{a.label}</span>
        <span aria-hidden="true">·</span>
        <span>Kixo on-chain</span>
        {now > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{newsAgo(it.ts, now)}</span>
          </>
        )}
      </span>
      <div className="mt-1.5 flex gap-3">
        {it.image && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element -- proxied coin logo
          <img src={proxied(it.image)} alt="" loading="lazy" onError={() => setImgOk(false)} className="size-10 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-bg font-mono text-xs text-text-2">{coin?.symbol.slice(0, 2) ?? "?"}</span>
        )}
        <span className="min-w-0">
          {it.mint ? (
            <Link href={`/token/${it.mint}`} onClick={closeOnPhone} className="block text-sm leading-snug text-text hover:underline">
              {it.title}
            </Link>
          ) : (
            <span className="block text-sm leading-snug text-text">{it.title}</span>
          )}
          {it.summary && <span className="mt-1 block font-mono text-[11px] leading-relaxed text-text-2">{it.summary}</span>}
        </span>
      </div>
      {it.mint && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Link href={`/token/${it.mint}`} onClick={closeOnPhone} className="flex h-7 shrink-0 items-center rounded-md border border-emerald/30 bg-emerald/10 px-3 text-xs text-emerald transition-colors hover:bg-emerald/20">
            Trade
          </Link>
          <LiveChange mint={it.mint} />
          {it.x_url && (
            <a href={it.x_url} target="_blank" rel="noopener noreferrer" className="ml-auto flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border border-border px-2.5 text-xs text-text-2 transition-colors hover:text-text">
              Coin on X
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** A coin's market cap and 5m and 1h change now, from the shared market feed. The alert
 *  says what happened; this says where the coin stands as the reader decides. */
function LiveChange({ mint }: { mint: string }) {
  const { markets, tokens } = useRadarFeed();
  const m = markets[mint] ?? tokens.find((t) => t.mint === mint)?.market ?? null;
  if (!m) return null;
  const pct = (v: number | null | undefined, label: string) =>
    v == null ? null : <span className={v >= 0 ? "text-positive" : "text-negative"}>{`${v >= 0 ? "+" : ""}${v.toFixed(1)}% ${label}`}</span>;
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] whitespace-nowrap text-text-2">
      {m.mc_usd != null && <span>{`MC ${shortUsd(m.mc_usd)}`}</span>}
      {pct(m.change_5m_pct, "5m")}
      {pct(m.change_1h_pct, "1h")}
    </span>
  );
}

const shortUsd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);

function Story({ it, now }: { it: NewsItem; now: number }) {
  const [playing, setPlaying] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const internal = it.url.startsWith("/");
  const fresh = now > 0 && now / 1000 - it.ts < 600;
  if (it.kind === "onchain") return <Alert it={it} now={now} />;

  const meta = (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
      {fresh && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" aria-label="Just in" />}
      {KIND_LABEL[it.kind] && <span className="text-text-2">{KIND_LABEL[it.kind]}</span>}
      {KIND_LABEL[it.kind] && <span aria-hidden="true">·</span>}
      <span className="truncate">{it.source}</span>
      {now > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{newsAgo(it.ts, now)}</span>
        </>
      )}
    </span>
  );

  // Videos: a large picture with a play button; it plays here, in the panel.
  if (it.kind === "video" && it.video) {
    return (
      <div className="px-4 py-3">
        <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-bg">
          {playing ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${it.video}?autoplay=1&rel=0`}
              title={it.title}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <button type="button" onClick={() => setPlaying(true)} aria-label={`Play video: ${it.title}`} className="group absolute inset-0">
              {it.image && imgOk && (
                // eslint-disable-next-line @next/next/no-img-element -- proxied third-party thumbnail
                <img src={proxied(it.image)} alt="" loading="lazy" onError={() => setImgOk(false)} className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
              )}
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-bg/80 text-text ring-1 ring-border transition-transform group-hover:scale-105">
                  <Play size={18} strokeWidth={1.5} className="ml-0.5" />
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="mt-2">{meta}</div>
        <a href={it.url} target="_blank" rel="noopener noreferrer" className="mt-1 line-clamp-2 block text-sm leading-snug text-text hover:underline">
          {it.title}
        </a>
        <Coins it={it} />
      </div>
    );
  }

  const text = (
    <span className="min-w-0 flex-1">
      {meta}
      <span className="mt-1 line-clamp-3 block text-sm leading-snug text-text">{it.title}</span>
      {it.summary && <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-text-2">{it.summary}</span>}
    </span>
  );
  const picture = it.image && imgOk && (
    // eslint-disable-next-line @next/next/no-img-element -- proxied third-party picture
    <img src={proxied(it.image)} alt="" loading="lazy" onError={() => setImgOk(false)} className="size-16 shrink-0 rounded-lg border border-border object-cover" />
  );
  const cls = "flex gap-3 px-4 pt-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-emerald";
  return (
    <div className="pb-3 transition-colors hover:bg-surface-2">
      {internal ? (
        <Link href={it.url} className={cls}>
          {text}
          {picture}
        </Link>
      ) : (
        <a href={it.url} target="_blank" rel="noopener noreferrer" className={cls}>
          {text}
          {picture}
        </a>
      )}
      <div className="px-4">
        <Coins it={it} />
      </div>
    </div>
  );
}

/** The coins a story names, with their live 1h change, each opening its trade page. */
function Coins({ it }: { it: NewsItem }) {
  const { markets, tokens } = useRadarFeed();
  if (!it.coins.length) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      {it.coins.map((c) => {
        const change = markets[c.mint]?.change_1h_pct ?? tokens.find((t) => t.mint === c.mint)?.market?.change_1h_pct ?? null;
        return (
          <Link
            key={c.mint}
            href={`/token/${c.mint}`}
            className="flex h-6 items-center gap-1.5 rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-text-2 transition-colors hover:border-emerald/40 hover:text-text"
          >
            ${c.symbol}
            {change != null && <span className={change >= 0 ? "text-positive" : "text-negative"}>{`${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</span>}
          </Link>
        );
      })}
    </span>
  );
}

/** The side panel: docked on the right on desktop (the page narrows beside it), full
 *  screen on a phone. Toggled from the sidebar, the top bar or the N key. */
export function NewsDock() {
  const f = useFeatures();
  const { open } = useNews(false);
  const pathname = usePathname();
  const on = f.news && open && pathname !== "/news";

  useEffect(() => {
    if (!f.news) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']");
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) toggleNews();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [f.news]);

  if (!on) return null;
  return <NewsWindow pathname={pathname} />;
}

type Rect = { x: number; y: number; w: number; h: number };
const RECT_KEY = "mx.news.rect";
const MODE_KEY = "mx.news.mode";
const MIN_W = 320;
const MIN_H = 280;

function fit(r: Rect): Rect {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = Math.min(Math.max(MIN_W, r.w), W - 16);
  const h = Math.min(Math.max(MIN_H, r.h), H - 16);
  return { w, h, x: Math.min(Math.max(8, r.x), W - w - 8), y: Math.min(Math.max(8, r.y), H - h - 8) };
}

function savedRect(): Rect {
  try {
    const r = JSON.parse(localStorage.getItem(RECT_KEY) ?? "null") as Rect | null;
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) return fit(r);
  } catch {}
  return fit({ x: window.innerWidth - 420, y: 64, w: 400, h: window.innerHeight - 96 });
}

/** The news panel. On a desktop it floats by default: drag it by its top bar anywhere on
 *  the screen and resize it from its corner, so the chart and buy box stay in view; its
 *  place and size are remembered. "Dock" pins it to the right edge instead (the page
 *  narrows beside it, or on a trade page it lies over the edge). Phones: full screen. */
function NewsWindow({ pathname }: { pathname: string }) {
  const [mode, setMode] = useState<"float" | "dock">(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(MODE_KEY) === "dock" ? "dock" : "float";
    } catch {
      return "float";
    }
  });
  const [rect, setRect] = useState<Rect | null>(() => (typeof window !== "undefined" ? savedRect() : null));
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const drag = useRef<{ kind: "move" | "size"; px: number; py: number; from: Rect } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => setDesktop(mq.matches);
    const onResize = () => setRect((r) => (r ? fit(r) : r));
    mq.addEventListener("change", onMq);
    window.addEventListener("resize", onResize);
    return () => {
      mq.removeEventListener("change", onMq);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const pick = (m: "float" | "dock") => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };
  const begin = (kind: "move" | "size", e: React.PointerEvent) => {
    if (!rect || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, px: e.clientX, py: e.clientY, from: rect };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    setRect(fit(d.kind === "move" ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy } : { ...d.from, w: d.from.w + dx, h: d.from.h + dy }));
  };
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      if (rect) localStorage.setItem(RECT_KEY, JSON.stringify(rect));
    } catch {}
  };

  if (!desktop || mode === "dock" || !rect) {
    // Docked (or a phone): the earlier layout.
    const over = pathname.startsWith("/token/");
    return (
      <aside
        aria-label="News"
        className={`fixed inset-0 z-50 flex flex-col bg-surface lg:inset-auto lg:top-0 lg:h-screen lg:w-95 lg:border-l lg:border-border ${
          over ? "lg:fixed lg:right-0 lg:shadow-2xl lg:shadow-black/70" : "lg:sticky lg:z-auto lg:shrink-0"
        }`}
      >
        {desktop && (
          <button type="button" onClick={() => pick("float")} title="Float the news window and move it anywhere" className="absolute top-3 right-24 z-10 flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-[11px] text-text-2 hover:bg-surface-2 hover:text-text">
            <PictureInPicture2 size={12} strokeWidth={1.5} /> Float
          </button>
        )}
        <NewsFeed onClose={() => setNewsOpen(false)} />
      </aside>
    );
  }

  return (
    <aside
      aria-label="News"
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/70"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {/* Drag bar */}
      <div onPointerDown={(e) => begin("move", e)} onPointerMove={move} onPointerUp={end} className="flex h-7 shrink-0 cursor-move touch-none items-center gap-2 border-b border-border bg-surface-2 px-2 select-none">
        <GripHorizontal size={14} strokeWidth={1.5} className="text-muted" />
        <span className="text-[11px] text-muted">Drag to move · corner to resize</span>
        <button type="button" onClick={() => pick("dock")} title="Pin the news to the right edge" className="ml-auto flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-text-2 hover:bg-surface-3 hover:text-text">
          <PanelRight size={12} strokeWidth={1.5} /> Dock
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <NewsFeed onClose={() => setNewsOpen(false)} />
      </div>
      {/* Resize handle */}
      <div
        onPointerDown={(e) => begin("size", e)}
        onPointerMove={move}
        onPointerUp={end}
        aria-label="Resize the news window"
        className="absolute right-0 bottom-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
      >
        <span className="absolute right-1 bottom-1 h-2 w-2 border-r-2 border-b-2 border-text-2/60" />
      </div>
    </aside>
  );
}
