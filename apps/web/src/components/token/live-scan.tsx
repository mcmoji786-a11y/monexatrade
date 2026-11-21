"use client";
/* Kixo AI's live scan of one coin, run when its analysis opens: who holds it and whether
   they are sitting on profit, whether the first-second bots and launch bundles already
   left, what the creator did and has left in its wallet, wallets funded by one wallet,
   proven traders in it, and the biggest exit. Everything comes from Kixo's own reading
   of the coin's trades (gateway /token/{mint}/wallets and /groups) plus the creator's
   live SOL balance, and none of it is shown elsewhere on the coin's page. */
import { useEffect, useState } from "react";
import { GATEWAY_HTTP, positionPnl, usd, type Position, type Wallets } from "@/lib/gateway";
import { useSmartWallets } from "@/lib/labels";
import { useRadarFeed } from "@/components/radar/use-radar-feed";

export type Finding = { tone: "bad" | "warn" | "good" | "info"; text: string };
type Group = { size: number; hold_pct: number; still_holding: number; dev?: boolean };
type Groups = { bundles: Group[]; clusters: Group[]; checked?: number; of?: number; scanning?: boolean };

export type Scan = { status: "scanning" | "done" | "none"; findings: Finding[] };

/** The checks shown while the scan runs. */
export const SCAN_STEPS = ["Reading every holder", "Checking the creator's wallet", "Looking for wallets that act together", "Checking proven traders"];

export function useLiveScan(mint: string): Scan {
  const [state, setState] = useState<{ mint: string; w: Wallets | null; g: Groups | null; devSol: number | null; done: boolean }>({ mint, w: null, g: null, devSol: null, done: false });
  useEffect(() => {
    let alive = true;
    const get = <T,>(path: string) =>
      fetch(`${GATEWAY_HTTP}${path}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .catch(() => null);
    (async () => {
      const [w, g] = await Promise.all([get<Wallets>(`/token/${encodeURIComponent(mint)}/wallets`), get<Groups>(`/token/${encodeURIComponent(mint)}/groups`)]);
      let devSol: number | null = null;
      if (w?.dev?.wallet) {
        const b = await Promise.race([get<{ sol: number }>(`/wallet/${w.dev.wallet}/balance`), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
        devSol = b?.sol ?? null;
      }
      if (alive) setState({ mint, w, g, devSol, done: true });
    })();
    return () => {
      alive = false;
    };
  }, [mint]);
  const smart = useSmartWallets();
  const { solUsd } = useRadarFeed();
  if (state.mint !== mint || !state.done) return { status: "scanning", findings: [] };
  if (!state.w || (!state.w.holders.length && !state.w.trader_stats)) return { status: "none", findings: [] };
  return { status: "done", findings: findings(state.w, state.g, state.devSol, smart, solUsd) };
}

const pctOf = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)}%`;

function findings(w: Wallets, g: Groups | null, devSol: number | null, smart: Set<string>, solUsd: number | null): Finding[] {
  const out: Finding[] = [];
  const money = (sol: number) => (solUsd ? usd(sol * solUsd) : `${sol.toFixed(2)} SOL`);
  const sold = (p: Position) => p.bought_tokens > 0 && p.sold_tokens >= p.bought_tokens * 0.99;
  const gain = (ps: Position[]) => {
    const cost = ps.reduce((a, p) => a + p.bought_sol, 0);
    return cost > 0 ? (ps.reduce((a, p) => a + positionPnl(p), 0) / cost) * 100 : null;
  };

  // The creator.
  const d = w.dev;
  if (d) {
    if (sold(d)) out.push({ tone: "bad", text: `The creator already sold everything they bought (took out ${money(d.sold_sol)})` });
    else if (d.sells > 0) out.push({ tone: "bad", text: `The creator has started selling: sold ${money(d.sold_sol)} so far and still holds ${pctOf(d.pct)}` });
    else if (d.balance > 0) out.push({ tone: "good", text: `The creator has not sold anything yet and holds ${pctOf(d.pct)}` });
  }
  if (devSol != null) {
    if (devSol < 0.1) out.push({ tone: "warn", text: "The creator's wallet is almost empty: often a throwaway wallet made just for this coin" });
    else out.push({ tone: "info", text: `The creator's wallet still has ${devSol.toFixed(devSol < 10 ? 2 : 0)} SOL${solUsd ? ` (${usd(devSol * solUsd)})` : ""}` });
  }

  // First-second buyers (usually bots).
  if (w.snipers.length) {
    const holding = w.snipers.filter((p) => !sold(p) && p.balance > 0);
    const share = holding.reduce((a, p) => a + p.pct, 0);
    if (!holding.length) out.push({ tone: "good", text: `All ${w.snipers.length} wallets that bought in the first seconds have already sold. Less selling still to come from them` });
    else {
      const up = gain(holding);
      out.push({
        tone: share >= 5 ? "bad" : "warn",
        text: `${holding.length} of the ${w.snipers.length} first-second buyers still hold ${pctOf(share)}${up != null && up > 20 ? `, sitting on +${up.toFixed(0)}% profit` : ""}. They usually sell into any rise`,
      });
    }
  }

  // The biggest holders and their profit.
  const top = [...w.holders].filter((p) => !p.dev).sort((a, b) => b.pct - a.pct).slice(0, 10);
  if (top.length >= 3) {
    const share = top.reduce((a, p) => a + p.pct, 0);
    const up = gain(top);
    if (up != null && up >= 100) out.push({ tone: "bad", text: `The ${top.length} biggest holders own ${pctOf(share)} and are up +${up.toFixed(0)}% on average: a lot of profit waiting to be sold` });
    else if (up != null && up < -10) out.push({ tone: "info", text: `The ${top.length} biggest holders own ${pctOf(share)} and are at a loss (${up.toFixed(0)}%): less likely to sell right now` });
  }

  // Wallets acting together.
  const bundles = (g?.bundles ?? []).filter((b) => b.still_holding > 0 && b.hold_pct >= 1);
  if (bundles.length) {
    const share = bundles.reduce((a, b) => a + b.hold_pct, 0);
    const n = bundles.reduce((a, b) => a + b.still_holding, 0);
    out.push({ tone: share >= 10 ? "bad" : "warn", text: `${n} wallets that bought together at launch still hold ${pctOf(share)}. Often the creator's own wallets` });
  }
  const clusters = (g?.clusters ?? []).filter((c) => c.still_holding > 0 && c.hold_pct >= 1);
  for (const c of clusters.slice(0, 2)) {
    out.push({ tone: c.dev || c.hold_pct >= 10 ? "bad" : "warn", text: `${c.size} wallets funded by the same wallet${c.dev ? ", together with the creator," : ""} hold ${pctOf(c.hold_pct)}: one person can sell them all at once` });
  }

  // Proven traders.
  const proven = w.holders.filter((p) => smart.has(p.wallet) && p.balance > 0);
  const provenOut = (w.top_sellers ?? []).filter((p) => smart.has(p.wallet) && sold(p));
  if (proven.length) out.push({ tone: "good", text: `${proven.length} proven profitable trader${proven.length === 1 ? " holds" : "s hold"} it (${pctOf(proven.reduce((a, p) => a + p.pct, 0))})` });
  if (provenOut.length) out.push({ tone: "warn", text: `${provenOut.length} proven trader${provenOut.length === 1 ? " has" : "s have"} already sold out of it` });

  // Who made money, and the money flow.
  const t = w.trader_stats;
  if (t && t.traders >= 10) {
    const r = t.in_profit / t.traders;
    out.push({ tone: r < 0.35 ? "bad" : r >= 0.6 ? "good" : "info", text: `${t.in_profit} of ${t.traders} people who traded it are in profit (${Math.round(r * 100)}%)` });
    const net = t.bought_sol - t.sold_sol;
    out.push({ tone: net >= 0 ? "info" : "warn", text: `Buyers put in ${money(t.bought_sol)}; sellers took out ${money(t.sold_sol)}` });
  }
  const exit = (w.top_sellers ?? [])[0];
  if (exit && t && t.sold_sol > 0 && exit.sold_sol >= t.sold_sol * 0.15) {
    out.push({ tone: "warn", text: `One wallet made the biggest exit: sold ${money(exit.sold_sol)} (${Math.round((exit.sold_sol / t.sold_sol) * 100)}% of all selling)` });
  }

  // Worst first, then the rest.
  const order = { bad: 0, warn: 1, good: 2, info: 3 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 8);
}
