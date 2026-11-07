/** AI coin analysis: the contract between the UI and whatever produces the analysis.
 *  The engine is not chosen yet (a hosted model API or Kixo's own model), so
 *  `analyze` reports "not ready". Wiring an engine later only changes this file
 *  (and a gateway route), not the button or popup. */

import { pct, price, usd, type FeedToken } from "./gateway";
import type { DiscoverRow } from "./categories";
import type { Safety } from "./safety";

/** One on-chain fact sent to the engine and shown to the user. */
export type Fact = { label: string; value: string };

/** Everything the analysis is based on. Only real data: no guesses filled in. */
export type AnalysisInput = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  facts: Fact[];
  /** The coin's safety score and its reasons (safety.ts), the same as on its card. */
  safety?: Safety | null;
};

export type AnalysisResult =
  | { status: "not_ready" }
  | { status: "ok"; summary: string; strengths: string[]; risks: string[]; watch: string[]; source?: "ai" | "rules" }
  | { status: "error"; message: string };

export async function analyze(input: AnalysisInput): Promise<AnalysisResult> {
  // No AI engine is connected yet. Until it is, a quick read built from the same
  // on-chain checks as the coin's safety score, labelled as such.
  return quickRead(input) ?? { status: "not_ready" };
}

/** A plain-words read of a coin from Kixo's on-chain checks (no AI): what looks good,
 *  what looks risky and what to watch. Every line comes from a real measured signal. */
export function quickRead(input: AnalysisInput): AnalysisResult | null {
  const s = input.safety;
  if (!s) return null;
  const has = (label: string) => s.factors.some((f) => f.label.startsWith(label));
  const line = (f: { label: string; detail?: string }) => (f.detail ? `${f.label} (${f.detail})` : f.label);
  const strengths = [
    ...s.factors.filter((f) => f.points > 0).map(line),
    ...(!has("Mint authority") ? ["Mint authority revoked: no new tokens can be created"] : []),
    ...(!has("Freeze authority") ? ["Freeze authority revoked: wallets cannot be frozen"] : []),
    ...(!has("Top 10 wallets") && !has("Top 10 share") ? ["Holdings are spread out: the top 10 wallets hold a small share"] : []),
    ...(!has("Dev holds") && !has("Dev share") && !has("Dev sold") && !has("Dev is selling") ? ["The dev holds little and has not sold"] : []),
  ];
  const risks = s.factors.filter((f) => f.points < 0).slice(0, 6).map(line);
  const watch: string[] = [];
  if (has("Under 2 minutes") || has("Under 30 minutes")) watch.push("It is very new: most rugs happen in the first hour");
  if (!has("Dev sold everything")) watch.push("The dev wallet: a dev sale often comes before a drop");
  if (has("Top 10 wallets")) watch.push("The top 10 wallets: if they start selling, the price can fall fast");
  if (has("Liquidity under")) watch.push("Liquidity: a large sell can move the price a lot");
  if (has("Sells far outnumber buys")) watch.push("Order flow: sellers are leading right now");
  const level = s.level === "higher" ? "fewer red flags than most new coins" : s.level === "medium" ? "some warning signs worth checking" : "several red flags";
  return {
    status: "ok",
    source: "rules",
    summary: `Safety score ${s.score} of 100: ${level}. ${risks.length ? `The biggest concern: ${risks[0].charAt(0).toLowerCase()}${risks[0].slice(1)}.` : "No red flags in holders, dev or authorities so far."}`,
    strengths: strengths.slice(0, 5),
    risks,
    watch: watch.slice(0, 4),
  };
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
