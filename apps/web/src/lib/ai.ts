/** AI coin analysis: the contract between the UI and whatever produces the analysis.
 *  The engine is not chosen yet (a hosted model API or MONEXA's own model), so
 *  `analyze` reports "not ready". Wiring an engine later only changes this file
 *  (and a gateway route), not the button or popup. */

import { pct, price, usd, type FeedToken } from "./gateway";
import type { DiscoverRow } from "./categories";

/** One on-chain fact sent to the engine and shown to the user. */
export type Fact = { label: string; value: string };

/** Everything the analysis is based on. Only real data: no guesses filled in. */
export type AnalysisInput = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  facts: Fact[];
};

export type AnalysisResult =
  | { status: "not_ready" }
  | { status: "ok"; summary: string; strengths: string[]; risks: string[]; watch: string[] }
  | { status: "error"; message: string };

export async function analyze(input: AnalysisInput): Promise<AnalysisResult> {
  void input; // sent to the engine once one is connected
  return { status: "not_ready" };
}

const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString());
const p1 = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);

/** The facts for a Discover row. */
export function inputFromRow(r: DiscoverRow): AnalysisInput {
  return {
    mint: r.mint,
    symbol: r.symbol,
    name: r.name,
    image: r.image,
    facts: [
      { label: "Price", value: price(r.priceUsd) },
      { label: "Market cap", value: usd(r.mcUsd) },
      { label: "Liquidity", value: usd(r.liquidityUsd) },
      { label: "Change 5m", value: pct(r.change5m) },
      { label: "Change 1h", value: pct(r.change1h) },
      { label: "Volume 1h", value: usd(r.vol1hUsd) },
      { label: "Buys / sells 1h", value: `${n(r.buys1h)} / ${n(r.sells1h)}` },
      { label: "Holders", value: `${r.holdersApprox && r.holders != null ? "~" : ""}${n(r.holders)}` },
      { label: "Top 10 hold", value: p1(r.top10Pct) },
      { label: "Dev holds", value: p1(r.devPct) },
      { label: "Early buyers hold", value: p1(r.sniperPct) },
      { label: "Socials", value: [r.twitter && "X", r.telegram && "Telegram", r.website && "Website"].filter(Boolean).join(", ") || "None" },
    ],
  };
}

/** The facts for a fresh launch on Sol Radar, from our own decoder. */
export function inputFromLaunch(t: FeedToken): AnalysisInput {
  const m = t.market;
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    image: t.meta?.image ?? null,
    facts: [
      { label: "Price", value: m?.sol_quoted ? price(m.price_usd) : "—" },
      { label: "Market cap", value: m?.sol_quoted ? usd(m.mc_usd) : "—" },
      { label: "Bonding curve", value: m ? `${m.curve_progress.toFixed(1)}%` : "—" },
      { label: "Change 5m", value: pct(m?.change_5m_pct) },
      { label: "Volume 1h", value: usd(m?.volume_1h_usd) },
      { label: "Buys / sells 1h", value: m ? `${m.buys_1h} / ${m.sells_1h}` : "—" },
      { label: "Holders", value: m ? `~${m.holders}` : "—" },
      { label: "Top 10 hold", value: p1(m?.top10_pct) },
      { label: "Dev holds", value: p1(m?.dev_pct) },
      { label: "Early buyers", value: m ? `${m.snipers} · ${m.sniper_pct.toFixed(1)}%` : "—" },
      { label: "Whale buys 1h", value: n(m?.whale_buys_1h) },
      { label: "Socials", value: [t.meta?.twitter && "X", t.meta?.telegram && "Telegram", t.meta?.website && "Website"].filter(Boolean).join(", ") || "None" },
    ],
  };
}
