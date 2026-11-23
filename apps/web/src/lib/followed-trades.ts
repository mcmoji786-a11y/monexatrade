"use client";
/* The trades on one coin by the traders a user follows, for the chart's trader pins:
   their Wallet Monitor wallets, the KOLs, and the Kixo traders they follow in Community.
   Wallet trades come from the gateway's wallet stream (every swap on any DEX, within
   seconds); Community traders' trades from the following feed. */
import { useEffect, useMemo, useState } from "react";
import { GATEWAY_HTTP, GATEWAY_WS } from "./gateway";
import { useMonitor } from "./prefs";
import { useAccount } from "./account";
import { getFeed } from "./social";

export type Pin = {
  id: string;
  /** Unix seconds. */
  time: number;
  buy: boolean;
  name: string;
  /** A picture URL (KOLs with an X account), else null for initials. */
  avatar: string | null;
  /** "2.50 SOL ($180)" or "$40". */
  amount: string;
  kind: "kol" | "wallet" | "trader";
};

type KolRow = { address: string; name: string; x: string };
let kols: KolRow[] | null = null;
let kolsLoading: Promise<KolRow[]> | null = null;
function loadKols(): Promise<KolRow[]> {
  if (kols) return Promise.resolve(kols);
  kolsLoading ??= fetch(`${GATEWAY_HTTP}/kols`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { kols: [] }))
    .then((v: { kols?: KolRow[] }) => (kols = v.kols ?? []))
    .catch(() => (kols = []));
  return kolsLoading;
}

const MAX_WALLETS = 100;
const solTxt = (sol: number, solUsd: number | null | undefined) => `${sol.toFixed(sol >= 10 ? 1 : 2)} SOL${solUsd ? ` ($${Math.round(sol * solUsd).toLocaleString("en-US")})` : ""}`;

export function useFollowedTrades(mint: string, on: boolean): Pin[] {
  const monitor = useMonitor().prefs.wallets;
  const [kolList, setKolList] = useState<KolRow[]>(kols ?? []);
  useEffect(() => {
    if (on) void loadKols().then(setKolList);
  }, [on]);

  // Who each followed wallet is.
  const who = useMemo(() => {
    const m = new Map<string, { name: string; avatar: string | null; kind: Pin["kind"] }>();
    for (const k of kolList) m.set(k.address, { name: k.name, avatar: k.x ? `https://unavatar.io/x/${encodeURIComponent(k.x)}` : null, kind: "kol" });
    for (const w of monitor) if (!m.has(w.address)) m.set(w.address, { name: w.label || `${w.address.slice(0, 4)}…${w.address.slice(-4)}`, avatar: null, kind: "wallet" });
    return m;
  }, [kolList, monitor]);
  const key = on ? [...who.keys()].slice(0, MAX_WALLETS).sort().join(",") : "";

  const [walletPins, setWalletPins] = useState<{ mint: string; key: string; pins: Pin[] }>({ mint: "", key: "", pins: [] });
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    const toPin = (t: { signature: string; wallet: string; is_buy: boolean; sol: number; ts: number }, solUsd?: number | null): Pin | null => {
      const w = who.get(t.wallet);
      return w ? { id: t.signature, time: t.ts, buy: t.is_buy, name: w.name, avatar: w.avatar, amount: solTxt(t.sol, solUsd), kind: w.kind } : null;
    };
    const open = () => {
      ws = new WebSocket(`${GATEWAY_WS}/ws/wallets?w=${encodeURIComponent(key)}`);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data) as { type: string; mint?: string; sol_usd?: number | null; trades?: { mint: string; trade: Parameters<typeof toPin>[0] }[]; trade?: Parameters<typeof toPin>[0] };
        if (m.type === "history") {
          const pins = (m.trades ?? []).filter((x) => x.mint === mint).map((x) => toPin(x.trade, m.sol_usd)).filter((p): p is Pin => !!p);
          setWalletPins({ mint, key, pins });
        } else if (m.type === "trade" && m.mint === mint && m.trade) {
          const p = toPin(m.trade, m.sol_usd);
          if (p) setWalletPins((cur) => (cur.mint === mint && cur.key === key ? { ...cur, pins: [p, ...cur.pins.filter((x) => x.id !== p.id)].slice(0, 300) } : { mint, key, pins: [p] }));
        }
      };
      ws.onclose = () => {
        if (!stopped) retry = setTimeout(open, 5_000);
      };
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws?.close();
        else ws.close();
      }
    };
  }, [key, mint, who]);

  // Community traders the user follows: their (demo) trades on this coin.
  const signedIn = useAccount().status === "signed-in";
  const [traderPins, setTraderPins] = useState<{ mint: string; pins: Pin[] }>({ mint: "", pins: [] });
  useEffect(() => {
    if (!on || !signedIn) return;
    let alive = true;
    const load = () =>
      getFeed("following")
        .then(({ items }) => {
          if (!alive) return;
          const pins = items
            .filter((t) => t.mint === mint)
            .map((t): Pin => ({ id: `c${t.id}`, time: Math.floor(Date.parse(t.ts) / 1000), buy: t.side === "buy", name: t.display_name || (t.handle ? `@${t.handle}` : "Trader"), avatar: null, amount: `$${t.usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, kind: "trader" }));
          setTraderPins({ mint, pins });
        })
        .catch(() => {});
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [on, signedIn, mint]);

  return useMemo(() => {
    if (!on) return [];
    const a = walletPins.mint === mint && walletPins.key === key ? walletPins.pins : [];
    const b = traderPins.mint === mint ? traderPins.pins : [];
    return [...a, ...b].sort((x, y) => x.time - y.time);
  }, [on, walletPins, traderPins, mint, key]);
}
