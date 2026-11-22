"use client";
/* Solana right now, on the waitlist page: a ticker of the memecoins trending this minute
   and a live board of the newest launches and the hottest coins, with the quick on-chain
   checks Kixo shows on every coin. Real data (api/live, from Jupiter), every 15 seconds. */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { LiveCoin } from "@/app/api/live/route";

type Live = { fresh: LiveCoin[]; trending: LiveCoin[]; at: string | null };

/* One shared feed for the ticker and the board. */
let data: Live | null = null;
let started = false;
const subs = new Set<() => void>();
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const load = () =>
    fetch("/api/live")
      .then((r) => r.json() as Promise<Live>)
      .then((v) => {
        data = v;
        subs.forEach((f) => f());
      })
      .catch(() => {});
  load();
  setInterval(() => document.visibilityState === "visible" && load(), 15_000);
}
function useLive(): Live | null {
  return useSyncExternalStore(
    (f) => (start(), subs.add(f), () => subs.delete(f)),
    () => data,
    () => null,
  );
}

/** Seconds since page load, ticking, for coin ages. */
function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const usd = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v) >= 100 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`);
const tone = (v: number | null) => (v == null ? "" : v >= 0 ? "up" : "down");
function age(iso: string | null, now: number) {
  if (!iso || !now) return "";
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Logo({ c, size = 28 }: { c: LiveCoin; size?: number }) {
  const [bad, setBad] = useState(false);
  return bad || !c.icon ? (
    <span className="coin-logo empty" style={{ width: size, height: size }}>
      {c.symbol.slice(0, 1)}
    </span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="coin-logo" src={c.icon} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
  );
}

/* ---------------- Ticker ---------------- */

export function LiveTicker() {
  const live = useLive();
  const coins = live?.trending ?? [];
  if (!coins.length) return null;
  const row = (k: number) => (
    <span key={k}>
      {coins.map((c) => (
        <span key={c.id} className="tick">
          <Logo c={c} size={18} />
          <b>{c.symbol}</b>
          <span className="muted">{usd(c.mcap)}</span>
          <span className={tone(c.change5m)}>{pct(c.change5m)}</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="ticker" aria-label="Memecoins trending on Solana in the last 5 minutes">
      <span className="ticker-tag">
        <span className="live" aria-hidden="true" /> Trending now
      </span>
      <div className="ticker-view">
        <div className="ticker-track">{[0, 1].map(row)}</div>
      </div>
    </div>
  );
}

/* ---------------- Board ---------------- */

function Checks({ c }: { c: LiveCoin }) {
  const top = c.top10;
  return (
    <span className="checks">
      {c.mintOff != null && <i className={c.mintOff ? "ok" : "bad"}>{c.mintOff ? "Mint off" : "Mint on"}</i>}
      {c.freezeOff != null && <i className={c.freezeOff ? "ok" : "bad"}>{c.freezeOff ? "Freeze off" : "Freeze on"}</i>}
      {top != null && <i className={top <= 30 ? "ok" : top <= 60 ? "warn" : "bad"}>Top 10 {top.toFixed(0)}%</i>}
    </span>
  );
}

function Row({ c, now, kind }: { c: LiveCoin; now: number; kind: "fresh" | "hot" }) {
  return (
    <li className="coin-row">
      <Logo c={c} />
      <span className="coin-main">
        <span className="coin-name">
          <b>{c.symbol}</b>
          <span className="muted">{c.name !== c.symbol ? c.name : ""}</span>
        </span>
        <Checks c={c} />
      </span>
      {kind === "fresh" ? (
        <span className="coin-side">
          <span className="coin-age">{age(c.createdAt, now)}</span>
          <span className="muted">{c.holders != null ? `${c.holders.toLocaleString("en-US")} holders` : ""}</span>
        </span>
      ) : (
        <span className="coin-side">
          <span>{usd(c.mcap)}</span>
          <span className={tone(c.change5m)}>{pct(c.change5m)}</span>
        </span>
      )}
      {kind === "hot" && c.buyShare != null && (
        <span className="pressure" title={`${Math.round(c.buyShare * 100)}% of the last 5 minutes' volume was buying`}>
          <i style={{ width: `${Math.round(c.buyShare * 100)}%` }} />
        </span>
      )}
    </li>
  );
}

export function LiveBoard() {
  const live = useLive();
  const now = useNow();
  const loading = !live;
  return (
    <div className="live-board">
      <div className="live-col">
        <div className="live-head">
          <span>
            <span className="live" aria-hidden="true" /> Just launched
          </span>
          <span className="muted">age · holders</span>
        </div>
        <ol>
          {loading
            ? Array.from({ length: 6 }, (_, i) => <li key={i} className="coin-row skeleton" />)
            : live.fresh.map((c) => <Row key={c.id} c={c} now={now} kind="fresh" />)}
        </ol>
      </div>
      <div className="live-col">
        <div className="live-head">
          <span>
            <span className="live" aria-hidden="true" /> Trending · 5 min
          </span>
          <span className="muted">market cap · change · buy pressure</span>
        </div>
        <ol>
          {loading
            ? Array.from({ length: 6 }, (_, i) => <li key={i} className="coin-row skeleton" />)
            : live.trending.slice(0, 10).map((c) => <Row key={c.id} c={c} now={now} kind="hot" />)}
        </ol>
      </div>
    </div>
  );
}
