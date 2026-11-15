"use client";
/* KOL Tracker page: the KOLs (named, with their X accounts) and their trades live. A KOL
   can be added to Wallet Monitor for alerts by Email, Telegram or Discord. */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, ExternalLink, Search } from "lucide-react";
import { GATEWAY_WS, type TradeRow } from "@/lib/gateway";
import { getKols, xUrl, type Kol, type KolName } from "@/lib/kols";
import { tokenHref } from "@/lib/open-token";
import { useMonitor } from "@/lib/prefs";
import { TokenLogo } from "@/components/token/token-bits";
import { formatAge, useNow } from "@/components/radar/use-radar-feed";

type Row = { key: string; mint: string; symbol: string | null; image: string | null; trade: TradeRow; usd: number | null; kol: KolName | null };

export function KolBoard() {
  const [kols, setKols] = useState<Kol[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const rows = useKolTrades();
  const now = useNow();
  const monitor = useMonitor();

  useEffect(() => {
    let alive = true;
    const load = () =>
      getKols()
        .then((k) => alive && (setKols(k), setErr(null)))
        .catch((e) => alive && setErr(e instanceof Error ? e.message : "Could not load"));
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const list = useMemo(
    () => (kols ?? []).filter((k) => !q || `${k.name} ${k.x}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.last_trade ?? 0) - (a.last_trade ?? 0)),
    [kols, q],
  );
  const shown = only ? rows.filter((r) => r.trade.wallet === only) : rows;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-medium text-text">KOL Tracker</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">Well-known traders, named with their X accounts, and every trade they make on new Solana coins, live. Coins they bought show a KOL badge across Kixo</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="flex max-h-[720px] flex-col rounded-xl border border-border bg-surface">
          <label className="flex h-11 items-center gap-2 border-b border-border px-3">
            <Search size={14} strokeWidth={1.5} className="text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search KOLs" aria-label="Search KOLs" className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted" />
          </label>
          {err ? (
            <p className="px-4 py-8 text-sm text-muted">{err}</p>
          ) : !kols ? (
            <p className="px-4 py-8 text-sm text-muted">Loading</p>
          ) : kols.length === 0 ? (
            <p className="px-4 py-8 text-sm leading-6 text-text-2">No KOLs listed yet. Kixo adds well-known traders here once their wallets are confirmed</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {list.map((k) => {
                const watched = monitor.has(k.address);
                return (
                  <li key={k.address} className={`flex items-center gap-3 px-3 py-2.5 ${only === k.address ? "bg-surface-2" : ""}`}>
                    <button type="button" onClick={() => setOnly(only === k.address ? null : k.address)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={only === k.address}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs text-text-2">{k.name.slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-text">{k.name}</span>
                        <span className="block truncate font-mono text-[11px] text-muted">
                          {k.buys_24h} buys · {k.sells_24h} sells · {k.last_trade && now ? `${formatAge(now / 1000 - k.last_trade)} ago` : "quiet today"}
                        </span>
                      </span>
                    </button>
                    {k.x && (
                      <a href={xUrl(k.x)} target="_blank" rel="noopener noreferrer" aria-label={`@${k.x} on X`} className="text-muted hover:text-text">
                        <ExternalLink size={13} strokeWidth={1.5} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => (watched ? monitor.remove(k.address) : monitor.add(k.address, k.name))}
                      title={watched ? "Stop alerts for this KOL" : "Alert me when this KOL trades (Wallet Monitor)"}
                      aria-label={watched ? "Stop alerts" : "Alert me"}
                      className={`flex h-7 w-7 items-center justify-center rounded-md border ${watched ? "border-emerald/40 text-emerald" : "border-border text-text-2 hover:text-text"}`}
                    >
                      {watched ? <BellOff size={12} strokeWidth={1.5} /> : <Bell size={12} strokeWidth={1.5} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm text-text">{only ? `Trades by ${kols?.find((k) => k.address === only)?.name ?? "this KOL"}` : "Live KOL trades"}</p>
            {only && (
              <button type="button" onClick={() => setOnly(null)} className="text-xs text-text-2 hover:text-text">
                Show all
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted">{kols?.length ? "No KOL trades in the last while. New ones appear here the moment they confirm" : "Trades appear here once KOLs are listed"}</p>
          ) : (
            <ul className="max-h-[680px] divide-y divide-border overflow-y-auto">
              {shown.map((r) => (
                <li key={r.key} className="row-in flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-28 shrink-0 truncate text-text">{r.kol?.name ?? "KOL"}</span>
                  <span className={`w-9 shrink-0 text-xs ${r.trade.is_buy ? "text-positive" : "text-negative"}`}>{r.trade.is_buy ? "Buy" : "Sell"}</span>
                  <Link href={tokenHref(r.mint)} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                    <TokenLogo src={r.image} symbol={r.symbol ?? "?"} size={22} />
                    <span className="truncate text-text">{r.symbol ?? `${r.mint.slice(0, 4)}…`}</span>
                  </Link>
                  <span className="w-24 text-right font-mono text-xs text-text">
                    {r.trade.sol.toFixed(2)} SOL
                    {r.usd != null && <span className="block text-[11px] text-muted">${r.usd >= 1000 ? `${(r.usd / 1000).toFixed(1)}K` : r.usd.toFixed(0)}</span>}
                  </span>
                  <span className="w-10 text-right font-mono text-xs text-muted">{now ? formatAge(now / 1000 - r.trade.ts) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

/** The KOLs' trades: recent ones first, then each new one (gateway /ws/kols). */
function useKolTrades() {
  const [rows, setRows] = useState<Row[]>([]);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stop = false;
    const toRow = (m: { mint: string; symbol: string | null; image: string | null; trade: TradeRow; sol_usd: number | null; kol: KolName | null }): Row => ({
      key: m.trade.signature + m.trade.wallet,
      mint: m.mint,
      symbol: m.symbol,
      image: m.image,
      trade: m.trade,
      usd: m.sol_usd ? m.trade.sol * m.sol_usd : null,
      kol: m.kol,
    });
    const open = () => {
      ws = new WebSocket(`${GATEWAY_WS}/ws/kols`);
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "history") setRows((m.trades as Parameters<typeof toRow>[0][]).map(toRow).sort((a, b) => b.trade.ts - a.trade.ts).slice(0, 200));
          else if (m.type === "trade") setRows((cur) => [toRow(m), ...cur.filter((r) => r.key !== m.trade.signature + m.trade.wallet)].slice(0, 200));
        } catch {}
      };
      ws.onclose = () => {
        if (!stop) retry.current = setTimeout(open, 5_000);
      };
    };
    open();
    return () => {
      stop = true;
      clearTimeout(retry.current);
      ws?.close();
    };
  }, []);
  return rows;
}
