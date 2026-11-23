/* Kixo Agent as a trading coach: it follows what the user does on the page and talks them
   through it in plain words. A buy gets a plan, a sell gets the result, an automatic sale
   (take profit, stop loss, rug exit) is explained, and a held position is checked at a few
   levels (up 20, 50, 100 percent; down 10, 25 percent): is the profit enough, should it go.
   The advice leans on the next-minutes read (lib/agent/scalp.ts) when there is one. */
import { usd } from "@/lib/gateway";
import type { Filled } from "@/lib/trade-toast";
import type { DemoTrade } from "@/lib/demo";
import type { AgentMode } from "./settings";
import { scalpRead, type Scalp } from "./scalp";

const r0 = (x: number) => Math.round(x);
const pct = (x: number) => `${r0(Math.abs(x))} percent`;

/** What the user just did, in a sentence or three. */
export function onFill(f: Filled, mode: AgentMode, scalp: Scalp | null, longRisky: boolean): string {
  const sym = f.symbol || "it";
  const pro = mode === "pro";
  if (f.side === "buy") {
    const amount = f.usd != null ? usd(f.usd) : `${f.sol.toFixed(2)} sol`;
    const read = scalpRead(scalp);
    const now = read === "hot" ? (pro ? "Momentum strong." : "Good timing, buyers are strong right now.") : read === "weak" ? (pro ? "Momentum weak: tight stop." : "Heads up, buying is slowing down, so sell quickly if it dips.") : "";
    const risk = longRisky ? (pro ? "Keep it short." : "This one's risky, so don't hold it long.") : "";
    if (pro) return `Bought ${amount} of ${sym}. Target plus twenty, stop minus ten. ${now} ${risk}`.trim();
    if (mode === "degen") return `Aped ${amount} into ${sym}. I'm watching it. Take profit around plus twenty, bail at minus ten. ${now} ${risk}`.trim();
    return `Done, you bought ${amount} of ${sym}. I'm watching it for you. My plan: sell when you're up about 20 percent, or sell if it drops 10 percent. ${now} ${risk}`.trim();
  }
  const pnl = f.realizedUsd;
  if (pnl == null) return pro ? `Sold ${sym}.` : `Done, you sold ${sym}.`;
  const cost = f.usd != null ? f.usd - pnl : null;
  const p = cost && cost > 0 ? (pnl / cost) * 100 : null;
  if (pnl >= 0) {
    if (pro) return `Sold ${sym}. Plus ${usd(pnl)}${p != null ? `, ${pct(p)}` : ""}.`;
    if (mode === "degen") return `Sold ${sym} for ${usd(pnl)} profit. Paper hands? Nah, smart hands.`;
    return `Nice! You sold ${sym} and made ${usd(pnl)}${p != null ? `, that's ${pct(p)}` : ""}. Taking profit is how you win at this.`;
  }
  if (pro) return `Sold ${sym}. Minus ${usd(-pnl)}${p != null ? `, ${pct(p)}` : ""}.`;
  if (mode === "degen") return `Sold ${sym} for a ${usd(-pnl)} loss. Happens. Next one.`;
  return `You sold ${sym} at a ${usd(-pnl)} loss. That's okay, cutting small losses early is what keeps you safe.`;
}

/** A sale the user didn't click: their take profit, stop loss, trailing stop or Rug exit. */
export function onAutoSell(t: DemoTrade, mode: AgentMode): string | null {
  const sym = t.symbol || "your coin";
  const pnl = t.realized_usd != null ? Number(t.realized_usd) : null;
  const res = pnl == null ? "" : pnl >= 0 ? ` You made ${usd(pnl)}.` : ` You lost ${usd(-pnl)}, but it stopped a bigger loss.`;
  switch (t.source) {
    case "tp":
      return mode === "pro" ? `Take profit hit on ${sym}.${res}` : `Your take profit just sold ${sym}.${res}`;
    case "sl":
      return mode === "pro" ? `Stop loss hit on ${sym}.${res}` : `Your stop loss just sold ${sym} to protect you.${res}`;
    case "trail":
      return `Your trailing stop sold ${sym}.${res}`;
    case "rug_exit":
      return `Rug exit sold ${sym} for you because it looked like a rug.${res}`;
    case "limit_sell":
      return `Your sell order on ${sym} went through.${res}`;
    default:
      return null;
  }
}

/** The levels a held position is checked at, once each until it moves away again. */
const LEVELS = [100, 50, 20, -10, -25] as const;

/** Follows one held position and says something when it reaches a level. */
export class PositionCoach {
  private said = new Set<number>();
  private key = "";

  check(pos: { costUsd: number; valueUsd: number | null; key: string } | null, sym: string, mode: AgentMode, scalp: Scalp | null): string | null {
    if (!pos || pos.valueUsd == null || pos.costUsd <= 0) {
      this.said.clear();
      return null;
    }
    if (pos.key !== this.key) {
      // A new position (or more bought): start fresh.
      this.key = pos.key;
      this.said.clear();
    }
    const p = (pos.valueUsd / pos.costUsd - 1) * 100;
    const gain = pos.valueUsd - pos.costUsd;
    // Forget levels the position has moved well away from, so a return is spoken again.
    for (const l of [...this.said]) if ((l > 0 && p < l - 10) || (l < 0 && p > l + 5)) this.said.delete(l);
    const level = LEVELS.find((l) => (l > 0 ? p >= l : p <= l) && !this.said.has(l));
    if (level == null) return null;
    // Saying +100 covers +50 and +20 too.
    for (const l of LEVELS) if ((level > 0 && l > 0 && l <= level) || (level < 0 && l < 0 && l >= level)) this.said.add(l);
    return advice(level, p, gain, sym, mode, scalp);
  }
}

function advice(level: number, p: number, gain: number, sym: string, mode: AgentMode, scalp: Scalp | null): string {
  const read = scalpRead(scalp);
  const pro = mode === "pro";
  if (level > 0) {
    const head = pro ? `${sym} plus ${pct(p)}, ${usd(gain)}.` : level >= 100 ? `Huge! You doubled your money on ${sym}, you're up ${usd(gain)}.` : level >= 50 ? `Great trade, you're up ${pct(p)} on ${sym}, that's ${usd(gain)}.` : `You're up ${pct(p)} on ${sym}, about ${usd(gain)}. That's a solid win for a memecoin.`;
    const tail =
      read === "hot"
        ? pro
          ? "Momentum still strong: sell half, trail the rest."
          : "Buyers are still strong, so you could sell half now and let the rest ride."
        : read === "weak"
          ? pro
            ? "Momentum fading: take it."
            : "Buying is slowing down. I'd take the profit now."
          : pro
            ? "Lock in at least half."
            : level >= 50
              ? "Sell at least half now, so you keep the win no matter what."
              : "Is it enough? For a quick memecoin trade, yes. Selling at least half here is smart.";
    return `${head} ${tail}`;
  }
  if (level <= -25) return pro ? `${sym} minus ${pct(p)}. Cut it.` : `You're down ${pct(p)} on ${sym}. I'd sell now before it gets worse. Small losses are fine, big ones hurt.`;
  return pro ? `${sym} minus ${pct(p)}. Watch the stop.` : `You're down ${pct(p)} on ${sym}. If it keeps falling, sell to keep the loss small.`;
}

/** The user's own trades on this coin (this demo round), for "what did I do?". */
export type MyTrades = { buys: number; buyUsd: number; sells: number; sellUsd: number; realized: number };

export function summarize(trades: DemoTrade[] | null, mint: string, round: number): MyTrades | null {
  const mine = (trades ?? []).filter((t) => t.mint === mint && t.round === round);
  if (!mine.length) return null;
  const buys = mine.filter((t) => t.side === "buy");
  const sells = mine.filter((t) => t.side === "sell");
  return {
    buys: buys.length,
    buyUsd: buys.reduce((a, t) => a + Number(t.usd), 0),
    sells: sells.length,
    sellUsd: sells.reduce((a, t) => a + Number(t.usd), 0),
    realized: sells.reduce((a, t) => a + Number(t.realized_usd ?? 0), 0),
  };
}

/** "What did I do?" in a sentence or two. */
export function tradesStory(m: MyTrades | null, pos: { costUsd: number; valueUsd: number | null } | null, sym: string): string {
  if (!m) return `You haven't traded ${sym} yet.`;
  const parts = [`You bought ${m.buys} time${m.buys === 1 ? "" : "s"}, ${usd(m.buyUsd)} in total`];
  if (m.sells) parts.push(`and sold ${m.sells} time${m.sells === 1 ? "" : "s"} for ${usd(m.sellUsd)}`);
  let out = `${parts.join(" ")}.`;
  if (m.sells) out += m.realized >= 0 ? ` So far you've taken ${usd(m.realized)} of profit.` : ` So far you've lost ${usd(-m.realized)} on what you sold.`;
  if (pos && pos.valueUsd != null) {
    const p = (pos.valueUsd / pos.costUsd - 1) * 100;
    out += ` You still hold ${usd(pos.valueUsd)} worth, ${p >= 0 ? "up" : "down"} ${pct(p)}.`;
  } else if (m.sells) out += " You don't hold any now.";
  return out;
}

/** "Is my profit enough?" */
export function enoughAnswer(pos: { costUsd: number; valueUsd: number | null } | null, sym: string, scalp: Scalp | null): string {
  if (!pos || pos.valueUsd == null) return `You don't hold ${sym} right now.`;
  const p = (pos.valueUsd / pos.costUsd - 1) * 100;
  const read = scalpRead(scalp);
  if (p <= 0) return `You're not in profit yet, you're down ${pct(p)}. ${p <= -10 ? "If it keeps falling, sell to keep the loss small." : "Give it a moment, but keep your stop in place."}`;
  const enough = p >= 20 ? "Yes, that's a good profit for a memecoin." : "It's a small profit so far.";
  const next = read === "hot" ? "Buyers are still strong, so you could sell half and let the rest ride." : read === "weak" ? "Buying is slowing down, so I'd take it now." : p >= 20 ? "Selling at least half here is smart." : "You can hold a bit longer, but sell if it turns down.";
  return `You're up ${pct(p)}, about ${usd(pos.valueUsd - pos.costUsd)}. ${enough} ${next}`;
}
