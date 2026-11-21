"use client";
/* The trade page's own tour: the first time a user opens a coin (after the site tour),
   a walk through the parts of the page. The "Page tour" button replays it. */
import { ArrowLeftRight, CandlestickChart, Check, Gauge, History, ListOrdered, ShieldCheck } from "lucide-react";
import { Tour, tourDone, type Step } from "./product-tour";

const EVENT = "kixo:trade-tour";

export function startTradeTour() {
  window.dispatchEvent(new Event(EVENT));
}

const STEPS: Step[] = [
  { anchor: null, icon: "brand", title: "Trading a coin", body: "Everything about one coin on one screen. A quick look at each part, under a minute" },
  { anchor: "trade-figures", icon: Gauge, title: "The numbers that matter", body: "Market cap leads; then price, the 5 minute and 1 hour change, liquidity, holders and volume, all live" },
  { anchor: "trade-tools", icon: ShieldCheck, title: "Safety and AI first", body: "The safety score and the Kixo AI word sum up the risks. Here too: price alerts, your notes, sharing and a full AI analysis" },
  { anchor: "trade-dev", icon: History, title: "Who made it", body: "The creator's earlier coins: rugged, died fast or graduated. A creator who rugged before is the clearest warning a coin can carry" },
  { anchor: "trade-chart", icon: CandlestickChart, title: "The chart", body: "Market cap or price, any time frame, drawing tools and indicators. Letters mark the trades that matter", extra: "marks" },
  { anchor: "trade-activity", icon: ListOrdered, title: "Every trade, live", body: "Trades, holders, top traders, and what the creator and early buyers did. Filter by whale, smart wallet or creator" },
  { anchor: "trade-box", icon: ArrowLeftRight, title: "Buy and sell", body: "Pick an amount and press Buy. In Demo it spends your virtual $10,000 at the real price, with the fees shown before you trade" },
  { anchor: null, icon: Check, title: "Ready to trade", body: "Try a small demo buy. If you want a guard rail, Settings, Safety sets a daily loss limit" },
];

// After the site tour, never on top of it.
const afterSiteTour = () => tourDone();

export function TradeTour() {
  return <Tour steps={STEPS} doneKey="kixo.tour.trade.v1" event={EVENT} label="Trade page tour" ready={afterSiteTour} />;
}
