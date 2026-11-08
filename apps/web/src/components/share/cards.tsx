"use client";

import type { DemoTrade } from "@/lib/demo";
import type { Recap } from "@/lib/achievements";
import { closeShareCard, useShareCard, type CoinShare, type Milestone, type ShareTrade } from "@/lib/share";
import { money, tinyPrice } from "@/components/trade/trade-panel";
import { C, compactUsd, loadCoinImage, multipleText, paintCoin, paintFacts, pctText, usdText, W } from "./canvas";
import { ShareDialog } from "./share-dialog";

/* The share cards. Results on virtual money always carry "Demo account"; coin cards
   show only live on-chain facts and never a promise. */

/** P&L of a sell as a share of what the sold tokens cost. */
export function tradeResult(t: DemoTrade) {
  const usd = Number(t.usd);
  const pnl = Number(t.realized_usd ?? 0);
  const cost = usd - pnl;
  return { usd, pnl, cost, pct: cost > 0 ? (pnl / cost) * 100 : 0, entry: cost / Number(t.tokens), exit: Number(t.price_usd) };
}

function duration(fromMs: number, toMs: number) {
  const s = Math.max(0, (toMs - fromMs) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

const DEMO = { text: "Demo account", tone: "warning" } as const;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/* ---------------- Closed trade ---------------- */

export function TradeShareCard({ trade: t, onClose }: { trade: ShareTrade; onClose: () => void }) {
  const r = tradeResult(t);
  const sym = t.symbol || t.mint.slice(0, 4);
  return (
    <ShareDialog
      title="Share trade"
      text={`Closed $${sym} at ${pctText(r.pct)} (${usdText(r.pnl)}) on my Kixo demo account`}
      fileName={`kixo-${sym}-${t.id}.png`}
      label={DEMO}
      footLeft="Virtual money at live market prices"
      seed={Number(t.id)}
      paintKey={`trade-${t.id}`}
      onClose={onClose}
      paint={(g, f) => {
        const tone = r.pnl >= 0 ? C.positive : C.negative;
        g.fillStyle = C.text;
        g.font = `500 46px ${f.sans}`;
        const s = `$${sym}`;
        g.fillText(s, 64, 222);
        const sw = g.measureText(s).width;
        g.fillStyle = C.text2;
        g.font = `400 26px ${f.sans}`;
        g.fillText(`Sold · ${new Date(t.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`, 64 + sw + 20, 220);
        g.fillStyle = tone;
        g.font = `600 150px ${f.mono}`;
        g.fillText(pctText(r.pct), 56, 382);
        g.font = `500 42px ${f.mono}`;
        g.fillText(usdText(r.pnl), 64, 444);
        const facts: [string, string][] = [
          ["Entry", tinyPrice(r.entry)],
          ["Exit", tinyPrice(r.exit)],
          ["Size", money(r.cost)],
        ];
        if (t.openedAt) facts.push(["Held", duration(new Date(t.openedAt).getTime(), new Date(t.ts).getTime())]);
        paintFacts(g, facts, f);
      }}
    />
  );
}

/* ---------------- Coin: "Kixo spotted $X" ---------------- */

export function CoinShareCard({ coin: c, onClose }: { coin: CoinShare; onClose: () => void }) {
  const sym = c.symbol || c.mint.slice(0, 4);
  const x = c.firstMcUsd && c.mcUsd ? c.mcUsd / c.firstMcUsd : null;
  const spotted = x != null && x >= 1.5;
  const text = spotted
    ? `Kixo spotted $${sym} at launch at ${compactUsd(c.firstMcUsd)} market cap. Now ${compactUsd(c.mcUsd)} (${multipleText(x!)})${c.safety != null ? `. Safety score ${c.safety}/100` : ""}`
    : `$${sym} on Kixo: ${compactUsd(c.mcUsd)} market cap${c.safety != null ? `, safety score ${c.safety}/100` : ""}. Live on-chain data`;
  return (
    <ShareDialog
      title="Share coin"
      text={text}
      fileName={`kixo-${sym}.png`}
      label={{ text: spotted ? "Spotted on Kixo" : "Live on Kixo", tone: "emerald" }}
      footLeft="Live on-chain data · Not financial advice"
      seed={c.mint.charCodeAt(0) + c.mint.charCodeAt(1)}
      paintKey={`coin-${c.mint}-${c.mcUsd}-${c.safety}`}
      extra={() => loadCoinImage(c.image)}
      onClose={onClose}
      paint={(g, f, img) => {
        paintCoin(g, img, sym, 64, 168, 72, f);
        g.fillStyle = C.text;
        g.font = `600 46px ${f.sans}`;
        g.fillText(`$${sym}`, 152, 218);
        const sw = g.measureText(`$${sym}`).width;
        g.fillStyle = C.text2;
        g.font = `400 24px ${f.sans}`;
        g.fillText((c.name || "").slice(0, 28), 152 + sw + 16, 216);

        if (spotted) {
          g.fillStyle = C.text2;
          g.font = `400 26px ${f.sans}`;
          g.fillText(`Spotted at launch at ${compactUsd(c.firstMcUsd)}`, 64, 290);
          g.fillStyle = C.positive;
          g.font = `600 140px ${f.mono}`;
          g.fillText(multipleText(x!), 56, 420);
          g.fillStyle = C.text;
          g.font = `500 34px ${f.mono}`;
          g.fillText(`Now ${compactUsd(c.mcUsd)} market cap`, 64, 474);
        } else {
          g.fillStyle = C.text2;
          g.font = `400 26px ${f.sans}`;
          g.fillText("Market cap", 64, 290);
          g.fillStyle = C.text;
          g.font = `600 130px ${f.mono}`;
          g.fillText(compactUsd(c.mcUsd), 56, 412);
        }

        // Safety score ring on the right.
        if (c.safety != null) {
          const cx = W - 190;
          const cy = 330;
          const rad = 92;
          const tone = c.safety >= 70 ? C.positive : c.safety >= 45 ? C.warning : C.negative;
          g.shadowBlur = 0;
          g.lineWidth = 12;
          g.strokeStyle = "rgba(237,237,237,0.12)";
          g.beginPath();
          g.arc(cx, cy, rad, 0, Math.PI * 2);
          g.stroke();
          g.strokeStyle = tone;
          g.lineCap = "round";
          g.beginPath();
          g.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0, Math.min(100, c.safety))) / 100);
          g.stroke();
          g.lineCap = "butt";
          g.fillStyle = C.text;
          g.font = `600 64px ${f.mono}`;
          const v = String(c.safety);
          g.fillText(v, cx - g.measureText(v).width / 2, cy + 18);
          g.fillStyle = C.text2;
          g.font = `400 22px ${f.sans}`;
          const l = "Safety score";
          g.fillText(l, cx - g.measureText(l).width / 2, cy + rad + 44);
          g.shadowBlur = 14;
        }

        const facts: [string, string][] = [];
        if (c.holders != null) facts.push(["Holders", c.holders.toLocaleString("en-US")]);
        if (c.top10Pct != null) facts.push(["Top 10 hold", `${c.top10Pct.toFixed(1)}%`]);
        if (c.liquidityUsd != null) facts.push(["Liquidity", compactUsd(c.liquidityUsd)]);
        if (c.ageSecs != null) facts.push(["Age", duration(0, c.ageSecs * 1000)]);
        paintFacts(g, facts.slice(0, 4), f);
      }}
    />
  );
}

/* ---------------- Milestone: "$X hit 5x" ---------------- */

export function MilestoneShareCard({ m, onClose }: { m: Milestone; onClose: () => void }) {
  const sym = m.symbol || m.mint.slice(0, 4);
  const pct = (m.valueUsd / m.costUsd - 1) * 100;
  return (
    <ShareDialog
      title="Share milestone"
      text={`$${sym} hit ${m.multiple}x on my Kixo demo account: ${money(m.costUsd)} is now ${money(m.valueUsd)}`}
      fileName={`kixo-${sym}-${m.multiple}x.png`}
      label={DEMO}
      footLeft="Virtual money at live market prices"
      seed={m.multiple + sym.length}
      paintKey={`ms-${m.mint}-${m.multiple}-${Math.round(m.valueUsd)}`}
      onClose={onClose}
      paint={(g, f) => {
        g.fillStyle = C.text;
        g.font = `500 46px ${f.sans}`;
        g.fillText(`$${sym}`, 64, 222);
        const sw = g.measureText(`$${sym}`).width;
        g.fillStyle = C.text2;
        g.font = `400 26px ${f.sans}`;
        g.fillText("Still holding", 64 + sw + 20, 220);
        g.fillStyle = C.positive;
        g.font = `600 150px ${f.mono}`;
        g.fillText(`${m.multiple}x`, 56, 382);
        g.font = `500 42px ${f.mono}`;
        g.fillText(pctText(pct), 64, 444);
        const facts: [string, string][] = [
          ["Put in", money(m.costUsd)],
          ["Worth now", money(m.valueUsd)],
        ];
        if (m.entryPrice != null) facts.push(["Entry", tinyPrice(m.entryPrice)]);
        facts.push(["Held", duration(new Date(m.openedAt).getTime(), Date.now())]);
        paintFacts(g, facts, f);
      }}
    />
  );
}

/* ---------------- Weekly recap ---------------- */

export function RecapShareCard({ recap: r, onClose }: { recap: Recap; onClose: () => void }) {
  const winRate = r.sells ? Math.round((r.wins / r.sells) * 100) : null;
  const range = `${day(r.from)} – ${day(r.to - 1)}`;
  return (
    <ShareDialog
      title="Share your week"
      text={`My week on Kixo: ${r.trades} trades, ${usdText(r.realizedUsd)} taken${winRate != null ? `, ${winRate}% win rate` : ""}${r.best ? `, best $${r.best.symbol} ${pctText(r.best.pct)}` : ""} (demo account)`}
      fileName={`kixo-week-${day(r.from).replace(" ", "-")}.png`}
      label={DEMO}
      footLeft="Virtual money at live market prices"
      seed={Math.floor(r.from / 86_400_000)}
      paintKey={`recap-${r.from}-${r.trades}-${Math.round(r.realizedUsd)}`}
      onClose={onClose}
      paint={(g, f) => {
        g.fillStyle = C.text;
        g.font = `500 46px ${f.sans}`;
        g.fillText("My week", 64, 222);
        const sw = g.measureText("My week").width;
        g.fillStyle = C.text2;
        g.font = `400 26px ${f.sans}`;
        g.fillText(range, 64 + sw + 20, 220);
        g.fillStyle = r.realizedUsd >= 0 ? C.positive : C.negative;
        g.font = `600 130px ${f.mono}`;
        g.fillText(usdText(r.realizedUsd), 56, 372);
        g.fillStyle = C.text2;
        g.font = `400 30px ${f.sans}`;
        g.fillText("profit taken", 64, 426);
        const facts: [string, string][] = [
          ["Trades", String(r.trades)],
          ["Win rate", winRate != null ? `${winRate}%` : "—"],
          ["Best trade", r.best ? `$${r.best.symbol.slice(0, 8)} ${pctText(r.best.pct)}` : "—"],
          ["Days traded", `${r.dayStreak} in a row`],
        ];
        paintFacts(g, facts, f);
      }}
    />
  );
}

/** The share card opened from anywhere, once per app. */
export function ShareCardHost() {
  const s = useShareCard();
  if (!s) return null;
  if (s.kind === "trade") return <TradeShareCard trade={s.trade} onClose={closeShareCard} />;
  if (s.kind === "coin") return <CoinShareCard coin={s.coin} onClose={closeShareCard} />;
  if (s.kind === "milestone") return <MilestoneShareCard m={s.m} onClose={closeShareCard} />;
  return <RecapShareCard recap={s.recap} onClose={closeShareCard} />;
}
