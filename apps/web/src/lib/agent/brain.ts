/* Kixo Agent's brain: what it says about a coin, worked out in code from the coin's own
   live data and Kixo's models (the same call as the AI analysis, components/token/
   ai-analysis.tsx plan()), in plain, casual English. Nothing is made up: a fact the data
   does not have is left out. Five modes change how it talks, never what the data says.

   brief():   the read when a coin page opens (call, why, what to do).
   Watcher:   the live trades, for the things worth interrupting for (dev sells, dumps...).
   answer():  a question, by voice or typed, answered from the same data. */
import { usd, type DevReport, type Market, type TradeRow } from "@/lib/gateway";
import type { AiRisk } from "@/lib/ai-risk";
import type { Safety } from "@/lib/safety";
import type { AgentMode, AgentSettings, AlertKind } from "./settings";
import { scalpRead, type Scalp } from "./scalp";
import { enoughAnswer, tradesStory, type MyTrades } from "./coach";

export type Plan = { tone: "bad" | "warn" | "good" | "muted"; title: string; sub: string; steps: string[] };

export type Finding = { tone: "bad" | "warn" | "good" | "info"; text: string };

export type CoinCtx = {
  symbol: string;
  ageSecs: number | null;
  mcUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  change5m: number | null;
  change1h: number | null;
  buys1h: number | null;
  sells1h: number | null;
  top10Pct: number | null;
  devPct: number | null;
  sniperPct: number | null;
  /** Our own decoder's figures for a launch we saw (dev sells, bundles, curve...). */
  market: Market | null;
  devReport: DevReport | null;
  risk: AiRisk | null;
  safety: Safety | null;
  plan: Plan | null;
  /** The Kixo Buy Score while it applies (minute 2 to 7), else null. */
  buyScore: number | null;
  /** The live scan of holders and wallets (plain sentences), when done. */
  findings: Finding[];
  /** Live trades, newest first. */
  trades: TradeRow[];
  solUsd: number | null;
  position: { costUsd: number; valueUsd: number | null } | null;
  /** Kixo AI's next minutes (lib/agent/scalp.ts), while the coin trades on its curve. */
  scalp: Scalp | null;
  /** The user's own trades on this coin (demo, this round). */
  myTrades: MyTrades | null;
};

const r0 = (x: number) => Math.round(x);
const pctWord = (x: number) => `${r0(Math.abs(x))} percent`;
/** "a 40 percent" / "an 85 percent" (an before 8, 11, 18, 80-89). */
const aPct = (x: number) => {
  const n = r0(Math.abs(x));
  const an = n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) || (n >= 800 && n <= 899);
  return `${an ? "an" : "a"} ${n} percent`;
};
const money = (x: number | null) => (x == null ? null : usd(x));
const sol = (x: number) => (x >= 10 ? `${r0(x)} sol` : `${x.toFixed(1)} sol`);
const age = (s: number) => (s < 120 ? `${r0(s)} seconds` : s < 7200 ? `${r0(s / 60)} minutes` : s < 172800 ? `${r0(s / 3600)} hours` : `${r0(s / 86400)} days`);

/** A stable choice per coin, so lines vary between coins without changing on re-renders. */
function pick<T>(list: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/* ---------------- The call ---------------- */

type Call = "avoid" | "wait_young" | "wait_falling" | "too_late" | "risky" | "ok_small" | "recommend" | "lean_up" | "skip";

function callOf(p: Plan | null): Call | null {
  if (!p) return null;
  const t = p.title.toLowerCase();
  if (t.startsWith("don't buy")) return "avoid";
  if (t.includes("don't buy yet")) return "wait_young";
  if (t.includes("falling")) return "wait_falling";
  if (t.includes("too late")) return "too_late";
  if (t.startsWith("risky")) return "risky";
  if (t.includes("recommends")) return "recommend";
  if (t.startsWith("ok to try")) return "ok_small";
  if (t.startsWith("leans up")) return "lean_up";
  return "skip";
}

const CALLS: Record<Call, Record<Exclude<AgentMode, "quiet">, string[]>> = {
  avoid: {
    buddy: ["Honestly, I'd stay away from {S}.", "I'd skip {S}, man. This one doesn't look good.", "Not this one. {S} has too many red flags."],
    coach: ["My advice is simple: don't buy {S} right now.", "I would not buy {S}. Let me tell you why."],
    pro: ["{S}: avoid.", "{S}. No buy."],
    degen: ["{S} smells like exit liquidity. Hard pass.", "Nah, {S} is a rug waiting to happen. I'm not touching it."],
  },
  wait_young: {
    buddy: ["{S} is brand new. Give it a few minutes before you jump in.", "Too early to call {S}. Let's watch it for a bit."],
    coach: ["{S} only just launched, so there isn't enough data yet. The safest move is to wait a few minutes."],
    pro: ["{S}: too early. Wait."],
    degen: ["{S} is still in the oven, fren. Let it cook a minute."],
  },
  wait_falling: {
    buddy: ["{S} is dropping right now. Don't catch a falling knife.", "Hold off on {S}. It's falling fast."],
    coach: ["{S} is falling right now, and buying while the price drops usually loses money. Wait until it settles."],
    pro: ["{S}: falling. Wait for it to settle."],
    degen: ["{S} is nuking. Don't be the bag holder, wait it out."],
  },
  too_late: {
    buddy: ["{S} already ran up hard. You'd probably be buying the top.", "I'd wait on {S}. It just pumped a lot."],
    coach: ["{S} already went up a lot in the last few minutes. Buying now often means buying the top, so it's better to wait for it to cool down."],
    pro: ["{S}: already pumped. Don't chase."],
    degen: ["{S} already sent it. Chasing green candles is how you get rekt."],
  },
  risky: {
    buddy: ["{S} is risky. If you really want in, go very small.", "{S} is a maybe, but a risky one."],
    coach: ["{S} has some warning signs. If you buy, use only a very small amount you're fine losing."],
    pro: ["{S}: risky. Tiny size or skip."],
    degen: ["{S} is a degen play for sure. Tiny bag only."],
  },
  ok_small: {
    buddy: ["{S} actually looks cleaner than most. A small bet could be okay.", "{S} looks decent for a memecoin. Small size though."],
    coach: ["{S} has fewer warning signs than most new coins. It's still risky, but a small buy is reasonable."],
    pro: ["{S}: okay for a small position."],
    degen: ["{S} looks kinda clean ser. Small bag, no full port."],
  },
  recommend: {
    buddy: ["{S} looks good. Kixo likes this one for a small buy.", "This is one of the better ones. {S} is worth a small buy."],
    coach: ["Kixo recommends a small buy on {S}. Coins like this one made money on average in the past."],
    pro: ["{S}: small buy. Kixo's score is strong."],
    degen: ["{S} has the juice. Kixo says small buy, I'm with it."],
  },
  lean_up: {
    buddy: ["{S} leans a bit bullish, but the edge is small."],
    coach: ["Kixo's forecast leans slightly up on {S} for the next hour, but it's only a small edge."],
    pro: ["{S}: slight upside lean. Small edge."],
    degen: ["{S} might send a little. Nothing crazy."],
  },
  skip: {
    buddy: ["Nothing special about {S}. I'd skip it.", "{S} is kinda meh. There are better ones."],
    coach: ["I don't see a strong reason to buy {S}. It's usually better to skip coins like this."],
    pro: ["{S}: no edge. Skip."],
    degen: ["{S} is mid. Next."],
  },
};

/* ---------------- The reasons ---------------- */

/** `text`: the trader's version, with the numbers (Pro mode); `easy`: the same in everyday
 *  words for someone new (every other mode). */
type Reason = { weight: number; good: boolean; text: string; easy: string };

/** A chance in words, for people who don't think in percentages. */
export function likely(x: number) {
  return x >= 0.75 ? "very likely" : x >= 0.5 ? "likely" : x >= 0.3 ? "possible" : x >= 0.15 ? "not very likely" : "unlikely";
}

function reasons(c: CoinCtx): Reason[] {
  const out: Reason[] = [];
  const m = c.market;
  if (m?.dev_sold_all) out.push({ weight: 10, good: false, text: "the dev already sold everything", easy: "the person who made this coin already sold all of theirs" });
  else if (m && m.dev_sells > 0) out.push({ weight: 8, good: false, text: `the dev has started selling and still holds ${pctWord(m.dev_pct)}`, easy: "the person who made this coin has started selling" });
  if (c.risk && c.risk.dump >= 0.4) out.push({ weight: 9, good: false, text: `Kixo AI gives it ${aPct(c.risk.dump * 100)} chance to crash within the hour`, easy: `Kixo AI thinks a crash is ${likely(c.risk.dump)} soon` });
  if (c.devReport && c.devReport.rugged > 0) out.push({ weight: 7, good: false, text: `this dev rugged ${c.devReport.rugged} of ${c.devReport.coins} earlier coins`, easy: "the same person ran away with the money on earlier coins" });
  const bundles = m?.bundle_pct ?? null;
  if (bundles != null && bundles >= 10) out.push({ weight: 6, good: false, text: `bundled wallets still hold ${pctWord(bundles)}`, easy: "a few wallets, probably the creator's own, still hold a big chunk and can dump it" });
  const top10 = m?.top10_pct ?? c.top10Pct;
  if (top10 != null && top10 > 30) out.push({ weight: 5, good: false, text: `the top ten wallets hold ${pctWord(top10)}`, easy: "a handful of wallets own most of it, so they can crash the price" });
  const snipers = m?.sniper_pct ?? c.sniperPct;
  if (snipers != null && snipers >= 10) out.push({ weight: 5, good: false, text: `snipers who bought in the first seconds still hold ${pctWord(snipers)}`, easy: "bots that bought in the first seconds are waiting to sell" });
  const holders = m?.holders ?? c.holders;
  if (holders != null && holders < 20 && (c.ageSecs ?? 0) > 120) out.push({ weight: 4, good: false, text: `only ${holders} wallets hold it`, easy: "hardly anyone owns it yet" });
  const flow = (c.buys1h ?? m?.buys_1h ?? 0) + (c.sells1h ?? m?.sells_1h ?? 0);
  const buys = c.buys1h ?? m?.buys_1h ?? 0;
  const sells = c.sells1h ?? m?.sells_1h ?? 0;
  if (flow >= 30 && sells > buys * 1.5) out.push({ weight: 4, good: false, text: `sellers are winning, ${sells} sells against ${buys} buys this hour`, easy: "more people are selling than buying" });
  if (c.liquidityUsd != null && c.liquidityUsd < 5000 && (m == null || m.complete)) out.push({ weight: 4, good: false, text: `liquidity is thin, about ${money(c.liquidityUsd)}`, easy: "there's very little money in it, so the price jumps around a lot" });
  // Good signs.
  if (m && !m.dev_sold_all && m.dev_sells === 0 && (c.ageSecs ?? 0) > 120) out.push({ weight: 4, good: true, text: "the dev hasn't sold anything", easy: "the person who made it hasn't sold anything" });
  if (top10 != null && top10 <= 20 && (holders ?? 0) >= 50) out.push({ weight: 4, good: true, text: `holders are spread out, the top ten hold just ${pctWord(top10)}`, easy: "lots of different people own it, not just a few" });
  if (flow >= 30 && buys > sells * 1.5) out.push({ weight: 4, good: true, text: `buyers are in control, ${buys} buys against ${sells} sells this hour`, easy: "more people are buying than selling" });
  if (c.risk && c.risk.dump < 0.15) out.push({ weight: 5, good: true, text: c.risk.dump < 0.01 ? "Kixo AI sees almost no crash risk" : `Kixo AI sees a low crash risk, about ${pctWord(c.risk.dump * 100)}`, easy: "Kixo AI doesn't expect it to crash" });
  if (c.devReport && c.devReport.graduated > 0 && c.devReport.rugged === 0) out.push({ weight: 3, good: true, text: `this dev graduated ${c.devReport.graduated} coins before and never rugged`, easy: "the person who made it has a good track record" });
  for (const f of c.findings) {
    if (f.tone === "good" && /proven/.test(f.text)) out.push({ weight: 4, good: true, text: f.text.replace(/\.$/, ""), easy: "some traders who usually win are holding it" });
  }
  return out.sort((x, y) => y.weight - x.weight);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The move right now, when it matters. */
function momentum(c: CoinCtx, mode: AgentMode): string | null {
  const ch = c.market?.change_5m_pct ?? c.change5m;
  if (ch == null || Math.abs(ch) < 15) return null;
  const up = ch > 0;
  if (mode === "pro") return `${up ? "Up" : "Down"} ${pctWord(ch)} in five minutes.`;
  if (mode === "degen") return up ? "It's sending right now." : "It's bleeding right now.";
  return up ? "It's going up fast right now." : "It's falling fast right now.";
}

/** What to do, in plain steps. */
function action(c: CoinCtx, call: Call, mode: AgentMode): string | null {
  const own = c.position && c.position.valueUsd != null;
  if (call === "avoid") {
    if (own) return mode === "pro" ? "You hold it. Sell into the next bounce." : "You own some. I'd sell it on the next small bounce.";
    return mode === "pro" ? null : "Skip this one, there are new coins every minute.";
  }
  if (call === "wait_young" || call === "wait_falling" || call === "too_late") {
    if (own && call === "too_late") return mode === "pro" ? "If you hold it, take some profit." : "If you own some, now's a good time to sell a bit and keep the profit.";
    return null;
  }
  const stop = call === "ok_small" ? 25 : call === "risky" ? 20 : call === "recommend" ? 40 : 20;
  if (mode === "pro") return `Size ${call === "risky" ? "about one percent" : "one to three percent"} of balance. Stop at minus ${stop}.`;
  if (mode === "degen") return `Small bag only. If it drops ${stop} percent, you're out.`;
  return `If you try it, only put in a little, money you're fine losing. If it falls ${stop} percent, sell and move on.`;
}

/** The next minutes from Kixo AI's scalp model, and the trade to take when they look hot.
 *  A coin the long-term read says no to can still be a quick trade: memecoins move in
 *  minutes, and the model is judged on exactly that trade. */
function nextMinutes(c: CoinCtx, mode: AgentMode, call: Call | null): { text: string; action: string | null } | null {
  const sc = c.scalp;
  const read = scalpRead(sc);
  if (!sc || !read) return null;
  const longNo = call === "avoid" || call === "risky" || call === "skip" || call === "wait_falling" || call === "wait_young";
  if (mode === "pro") {
    if (read === "hot") return { text: `Next two minutes: ${pctWord(sc.up20_2m * 100)} for plus twenty.`, action: "Scalp only. Take profit at plus twenty, stop at minus ten." };
    if (read === "weak") return { text: `Next two minutes weak: ${pctWord(sc.down15_2m * 100)} for minus fifteen.`, action: null };
    return null;
  }
  if (read === "hot") {
    const text = mode === "degen" ? `${longNo ? "But" : "And"} right now it's cooking, lots of buyers piling in.` : `${longNo ? "But" : "And"} right now lots of people are buying, so a quick jump up is ${likely(sc.up20_2m)}.`;
    const act =
      mode === "degen"
        ? "Quick in and out: grab twenty percent and leave. If it dips ten, cut it."
        : `If you want a quick trade: buy a little, sell as soon as it's up twenty percent, and if it drops ten percent, sell right away. Don't hold this one${longNo ? ", the bigger picture is risky" : ""}.`;
    return { text, action: act };
  }
  if (read === "weak") return { text: mode === "degen" ? "Momentum's dead right now." : "Right now buying has slowed down, so it's more likely to drop than go up.", action: null };
  return null;
}

/** The read when a coin's page opens. Null while there is too little data to say anything.
 *  Pro gets the numbers; every other mode gets everyday words and at most one level. */
export function brief(c: CoinCtx, mode: AgentMode): string | null {
  if (mode === "quiet") return null;
  const call = callOf(c.plan);
  if (!call) return null;
  const S = c.symbol || "this coin";
  const pro = mode === "pro";
  const lines: string[] = [pick(CALLS[call][mode], `${S}${call}`).replace("{S}", S)];
  const rs = reasons(c);
  const say = (r: Reason) => (pro ? r.text : r.easy);
  const negative = call === "avoid" || call === "risky" || call === "skip" || call === "wait_falling";
  const bad = rs.filter((r) => !r.good);
  const good = rs.filter((r) => r.good);
  if (negative) {
    const list = bad.slice(0, pro ? 1 : 2);
    if (list.length) {
      const joined = list.length === 2 ? `${say(list[0])}, and ${say(list[1])}` : say(list[0]);
      const opener = lines[0].endsWith("why.") ? "" : `${pick(["The reason:", "Why?", "Here's why:"], S)} `;
      lines.push(pro || mode === "degen" ? `${cap(joined)}.` : `${opener}${opener ? joined : cap(joined)}.`);
    } else if (c.plan?.sub && pro) {
      lines.push(`${c.plan.sub.replace(/\.$/, "")}.`);
    }
  } else {
    if (good[0]) lines.push(pro ? `${cap(good[0].text)}.` : `${pick(["Good sign:", "What I like:", "On the plus side,"], S)} ${good[0].easy}.`);
    if (bad[0] && !pro) lines.push(`${pick(["But careful,", "Just know", "One thing to watch:"], S)} ${bad[0].easy}.`);
  }
  const next = nextMinutes(c, mode, call);
  // The next-minutes read says what the move means; the bare move only without it.
  const mom = momentum(c, mode);
  if (mom && !next && call !== "wait_falling" && call !== "too_late") lines.push(mom);
  if (next) {
    lines.push(next.text);
    if (next.action) {
      lines.push(next.action);
      return lines.join(" ");
    }
  }
  const act = action(c, call, mode);
  if (act) lines.push(act);
  return lines.join(" ");
}

/* ---------------- Live alerts ---------------- */

/** An alert: `short` is a fixed phrase made ahead of time (it plays the instant it is
 *  needed, after a beep), then `text` gives the details in the user's mode. */
export type Alert = { kind: AlertKind; short: string | null; text: string; urgent: boolean };

/** The instant phrases, the same in every mode so they can be made ahead (preload). */
export const ALERT_SHORT: Partial<Record<AlertKind, string>> = {
  dev: "Sell! The dev is dumping.",
  bundles: "Sell! Bundles are dumping.",
  snipers: "Careful! Snipers are selling.",
  crowd: "Sell! Everyone's selling.",
  dump: "Heavy selling! Price is crashing.",
  whale: "Whale exit!",
  pump: "It's pumping!",
  setup: "Scalp setup!",
};

type Lines = Record<AgentMode, (x: string) => string>;
const DETAIL: Record<AlertKind, Lines> = {
  dev: {
    buddy: (x) => `They just sold ${x}.`,
    coach: (x) => `The creator just sold ${x}. That's often a sign the price will drop, so think about getting out.`,
    pro: (x) => `${x}.`,
    degen: (x) => `${x} straight into your bags.`,
    quiet: (x) => `${x}.`,
  },
  bundles: {
    buddy: (x) => `${x} These are probably the dev's own wallets.`,
    coach: (x) => `${x} Bundles are wallets that bought together at launch, usually the dev's. When they sell, more often follows.`,
    pro: (x) => x,
    degen: (x) => `${x} Classic.`,
    quiet: (x) => x,
  },
  snipers: {
    buddy: (x) => `${x} They usually sell into any pump.`,
    coach: (x) => `${x} Snipers are bots that bought in the first seconds. When they sell, the price often drops.`,
    pro: (x) => x,
    degen: (x) => `${x} The bots are taking profit.`,
    quiet: (x) => x,
  },
  crowd: {
    buddy: (x) => `${x} Holders are running for the exit.`,
    coach: (x) => `${x} When this many people sell at once, the price can keep falling.`,
    pro: (x) => x,
    degen: (x) => `${x} It's a stampede.`,
    quiet: (x) => x,
  },
  dump: {
    buddy: (x) => x,
    coach: (x) => `${x} Don't rush to buy the dip.`,
    pro: (x) => x,
    degen: (x) => `${x} It's nuking.`,
    quiet: (x) => x,
  },
  whale: {
    buddy: (x) => `A whale just sold ${x}.`,
    coach: (x) => `A big holder just sold ${x}. Big sells can push the price down.`,
    pro: (x) => `Whale sold ${x}.`,
    degen: (x) => `Whale just dumped ${x} on everyone.`,
    quiet: (x) => `A whale just sold ${x}.`,
  },
  setup: { buddy: (x) => x, coach: (x) => x, pro: (x) => x, degen: (x) => x, quiet: (x) => x },
  fading: { buddy: (x) => x, coach: (x) => x, pro: (x) => x, degen: (x) => x, quiet: (x) => x },
  mytrades: { buddy: (x) => x, coach: (x) => x, pro: (x) => x, degen: (x) => x, quiet: (x) => x },
  pump: {
    buddy: (x) => x,
    coach: (x) => `${x} Remember, buying after a big jump is risky.`,
    pro: (x) => x,
    degen: (x) => `${x} Sending!`,
    quiet: (x) => x,
  },
  position: { buddy: (x) => x, coach: (x) => x, pro: (x) => x, degen: (x) => x, quiet: (x) => x },
};

/** Watches a coin's live trades, trade by trade, for what is worth interrupting for: the
 *  dev, the launch bundles or the snipers selling, everyone selling at once, a whale
 *  leaving, a crash, the user's own position. Urgent ones go out the moment the trade
 *  arrives; each kind waits a little before repeating, so the agent never nags. */
export class Watcher {
  private seen = new Set<string>();
  private primed = false;
  private last: Partial<Record<AlertKind, number>> = {};
  private lastAny = 0;
  private lastRead: string | null = null;

  constructor(readonly mint: string) {}

  check(c: CoinCtx, s: AgentSettings, now: number): Alert[] {
    const fresh = c.trades.filter((t) => !this.seen.has(t.signature));
    fresh.forEach((t) => this.seen.add(t.signature));
    if (!this.primed) {
      // The trades already on screen are history, not news.
      this.primed = true;
      return [];
    }
    if (!fresh.length && !c.position && !c.scalp) return [];
    const out: Alert[] = [];
    const mode = s.mode;
    const allow = (k: AlertKind, gap: number) => s.alerts[k] && now - (this.last[k] ?? 0) > gap * 1000;
    const add = (k: AlertKind, detail: string, urgent: boolean) => out.push({ kind: k, short: ALERT_SHORT[k] ?? null, text: DETAIL[k][mode](detail), urgent });
    // Pro hears the SOL; everyone else the dollars ("about $450 worth").
    const value = (solAmt: number) => (mode === "pro" ? (c.solUsd ? `${sol(solAmt)}, about ${usd(solAmt * c.solUsd)}` : sol(solAmt)) : c.solUsd ? `about ${usd(solAmt * c.solUsd)} worth` : sol(solAmt));
    const sells = (list: TradeRow[]) => list.filter((t) => !t.is_buy);
    const total = (list: TradeRow[]) => list.reduce((x, t) => x + t.sol, 0);
    const wallets = (list: TradeRow[]) => new Set(list.map((t) => t.wallet)).size;

    // The creator selling: the second it happens.
    const dev = sells(fresh).filter((t) => t.dev);
    if (dev.length && allow("dev", 10)) add("dev", c.market?.dev_sold_all ? `everything, ${value(total(dev))}` : value(total(dev)), true);

    // The launch bundles selling (often the dev's own wallets).
    const bundles = sells(fresh).filter((t) => t.bundler && !t.dev);
    if (bundles.length && total(bundles) >= 0.2 && allow("bundles", 20)) {
      const n = wallets(bundles);
      add("bundles", `${n === 1 ? "A bundle wallet" : `${n} bundle wallets`} just sold ${value(total(bundles))}.`, true);
    }

    // The first-second snipers selling.
    const snipers = sells(fresh).filter((t) => t.sniper && !t.dev && !t.bundler);
    if (snipers.length && total(snipers) >= 0.3 && allow("snipers", 20)) {
      const n = wallets(snipers);
      add("snipers", `${n === 1 ? "A sniper" : `${n} snipers`} just sold ${value(total(snipers))}.`, true);
    }

    // Everyone selling: in the last 10 seconds many different wallets sell and the sells
    // swamp the buys.
    const tenS = c.trades.filter((t) => t.ts >= now / 1000 - 10);
    const outS = sells(tenS);
    const inS = tenS.filter((t) => t.is_buy);
    if (wallets(outS) >= 6 && outS.length >= inS.length * 3 && total(outS) >= total(inS) * 2 && total(outS) >= 1 && allow("crowd", 30)) {
      add("crowd", `${wallets(outS)} wallets sold in the last ten seconds, ${value(total(outS))}.`, true);
    }

    // A whale leaving: big for this coin, not a fixed amount.
    const mcSol = c.trades[0]?.mc_sol ?? 0;
    const big = Math.max(5, mcSol * 0.002);
    const whale = sells(fresh).filter((t) => !t.dev && t.sol >= big).sort((x, y) => y.sol - x.sol)[0];
    if (whale && allow("whale", 20)) add("whale", value(whale.sol), whale.sol >= big * 3);

    // Fast moves over the last minute, from the trades' market caps.
    const minute = c.trades.filter((t) => t.ts >= now / 1000 - 60);
    if (minute.length >= 5) {
      const latest = minute[0].mc_sol;
      const high = Math.max(...minute.map((t) => t.mc_sol));
      const low = Math.min(...minute.map((t) => t.mc_sol));
      const drop = high > 0 ? (1 - latest / high) * 100 : 0;
      const rise = low > 0 ? (latest / low - 1) * 100 : 0;
      if (drop >= 20 && sells(minute).length > minute.length / 2 && allow("dump", 45)) add("dump", `Down ${pctWord(drop)} in the last minute.`, drop >= 30);
      else if (rise >= 30 && allow("pump", 90)) add("pump", `Up ${pctWord(rise)} in the last minute.`, false);
    }


    // Kixo AI's next minutes: a scalp setup forming (it was not hot before), or momentum
    // fading on a coin the user holds.
    const sc = c.scalp;
    if (sc && now - sc.at < 10_000) {
      const read = scalpRead(sc);
      if (read === "hot" && this.lastRead !== "hot" && allow("setup", 60)) {
        out.push({ kind: "setup", short: ALERT_SHORT.setup ?? null, urgent: false, text: mode === "pro" ? `${pctWord(sc.up20_2m * 100)} for plus twenty in two minutes.` : `Lots of buyers are piling in right now, a quick jump up is ${likely(sc.up20_2m)}. Quick trade only: sell at plus twenty, get out at minus ten.` });
      }
      const holds = c.position && c.position.valueUsd != null;
      if (holds && read === "weak" && this.lastRead !== "weak" && allow("fading", 60)) {
        out.push({ kind: "fading", short: null, urgent: false, text: fadingLine(c, mode) });
      }
      this.lastRead = read;
    }

    // The most urgent first; ordinary lines at most every 8 seconds.
    const order: AlertKind[] = ["dev", "crowd", "bundles", "dump", "snipers", "whale", "position", "fading", "setup", "pump"];
    out.sort((x, y) => Number(y.urgent) - Number(x.urgent) || order.indexOf(x.kind) - order.indexOf(y.kind));
    const top = out[0];
    if (!top || (!top.urgent && now - this.lastAny < 8000)) return [];
    this.last[top.kind] = now;
    this.lastAny = now;
    return [top];
  }
}

/** Momentum fading on a held coin: take the profit if there is one, else be ready to cut. */
function fadingLine(c: CoinCtx, mode: AgentMode): string {
  const p = c.position && c.position.valueUsd != null && c.position.costUsd > 0 ? (c.position.valueUsd / c.position.costUsd - 1) * 100 : null;
  if (p != null && p >= 3) return mode === "pro" ? `Momentum fading. Up ${pctWord(p)}: take it.` : `Buying is slowing down on your coin and it may drop soon. You're up ${pctWord(p)}, so I'd take the profit now.`;
  return mode === "pro" ? "Momentum fading. Tight stop." : "Buying is slowing down on your coin and it may drop soon. Be ready to sell if it dips.";
}

/* ---------------- Questions ---------------- */

const GLOSSARY: [RegExp, string][] = [
  [/bundle/, "Bundles are wallets that bought together in the same block right at launch. It's often the dev splitting a big buy across many wallets, so they can dump all at once later."],
  [/sniper/, "Snipers are bots that buy in the first seconds after launch, then sell into the first pump."],
  [/rug|rugpull|rug pull/, "A rug pull is when the creator or insiders sell everything at once and the price collapses."],
  [/bonding curve|curve|graduat/, "New pump coins trade on a bonding curve, where the price rises as people buy. At a hundred percent the coin graduates to a normal pool. Most coins never get there."],
  [/liquidity/, "Liquidity is the money in the pool that you trade against. Low liquidity means even a small sell moves the price a lot."],
  [/market cap|mcap|\bmc\b/, "Market cap is the price times the supply, so what the whole coin is worth right now."],
  [/stop loss|stop-loss/, "A stop loss sells automatically when the price falls to a level you pick, so one bad trade can't wipe you out."],
  [/take profit/, "A take profit sells automatically when the price reaches your target, so you lock in the gain."],
  [/whale/, "A whale is a wallet that trades big, five sol or more at once on Kixo. Their sells can move the price hard."],
  [/slippage/, "Slippage is how far the price can move between when you click and when the trade lands."],
];

/** A question, answered from the coin's live data. Typed or spoken, casual English. */
export function answer(q: string, c: CoinCtx, mode: AgentMode): string {
  const t = q.toLowerCase().replace(/[^a-z0-9%$ .?']/g, " ");
  const m = c.market;
  const S = c.symbol || "this coin";
  const pro = mode === "pro";
  const explain = /what (is|are|does)|what's|meaning|explain|define/.test(t);

  if (explain) {
    for (const [re, a] of GLOSSARY) if (re.test(t)) return a;
  }
  if (/^(hi|hey|hello|yo|sup)\b/.test(t)) return pick(["Hey! Ask me anything about this coin.", "Hey. What do you want to know about this one?"], S);
  if (/thank/.test(t)) return pick(["Anytime.", "You got it.", "No problem, I'm watching it for you."], S);
  if (/what can you|help|how do you work/.test(t)) return "I watch this coin live and tell you if something dangerous happens. You can ask me if you should buy, about the dev, holders, trades, the risk, or your position.";

  // Position.
  if (/my (position|bag|trade|profit|loss|p ?n ?l)|am i (up|down)|how am i doing|my pnl/.test(t)) {
    const p = c.position;
    if (!p || p.valueUsd == null) return `You don't hold any ${S} right now.`;
    const pnl = p.valueUsd - p.costUsd;
    const pc = (p.valueUsd / p.costUsd - 1) * 100;
    return `You're ${pnl >= 0 ? "up" : "down"} ${usd(Math.abs(pnl))}, that's ${pctWord(pc)}. It's worth ${usd(p.valueUsd)} now.`;
  }
  // A question can touch several things ("how many holders and did the dev sell?"):
  // every topic it names is answered, in a fixed order, up to three.
  const topics: [RegExp, () => string][] = [
    [/\bdevs?\b|creator|developer|team/, () => {
      const parts: string[] = [];
      if (m?.dev_sold_all) parts.push("The dev already sold everything they bought.");
      else if (m && m.dev_sells > 0) parts.push(`The dev has sold ${m.dev_sells} time${m.dev_sells === 1 ? "" : "s"} and still holds ${pctWord(m.dev_pct)}.`);
      else if (m) parts.push(`The dev hasn't sold anything and holds ${pctWord(m.dev_pct)}.`);
      else if (c.devPct != null) parts.push(`The dev holds about ${pctWord(c.devPct)}.`);
      const d = c.devReport;
      if (d) parts.push(d.coins === 0 ? "It's a new dev, no earlier coins." : `Before this, they made ${d.coins} coins. ${d.rugged} rugged, ${d.died_fast} died fast and ${d.graduated} graduated.`);
      const f = c.findings.find((x) => /creator's wallet/.test(x.text));
      if (f && !pro) parts.push(f.text.replace(/\.$/, "") + ".");
      return parts.length ? parts.join(" ") : "I don't have the dev's data for this coin.";
    }],
    [/holder|wallets|owners|top ?10|top ten|who (owns|holds)/, () => {
      const h = m?.holders ?? c.holders;
      const top = m?.top10_pct ?? c.top10Pct;
      const parts: string[] = [];
      if (h != null) parts.push(`${h.toLocaleString()} wallets hold it${m?.holders_change_1h ? `, ${m.holders_change_1h > 0 ? "up" : "down"} ${Math.abs(m.holders_change_1h)} this hour` : ""}.`);
      if (top != null) parts.push(`The top ten hold ${pctWord(top)}.`);
      return parts.length ? parts.join(" ") : "I don't have holder data for this coin.";
    }],
    [/bundle|sniper/, () => (m ? `Bundled wallets hold ${pctWord(m.bundle_pct)} and snipers hold ${pctWord(m.sniper_pct)}.` : "I don't have bundle or sniper data for this coin.")],
    [/whale/, () => {
      const w = c.trades.filter((x) => x.sol >= 5 && x.ts >= Date.now() / 1000 - 600);
      const sold = w.filter((x) => !x.is_buy).length;
      return w.length ? `In the last ten minutes, ${w.length - sold} whale buys and ${sold} whale sells.` : m?.whale_buys_1h ? `${m.whale_buys_1h} whale buys this hour.` : "No whale trades lately.";
    }],
    [/trade|transaction|\btxn?s?\b|how many (buys|sells)|volume|activity/, () => {
      const total = m?.trades_total;
      const b = c.buys1h ?? m?.buys_1h;
      const sl = c.sells1h ?? m?.sells_1h;
      const recent = c.trades.filter((x) => x.ts >= Date.now() / 1000 - 300);
      const parts: string[] = [];
      if (total != null) parts.push(`${total.toLocaleString()} trades so far.`);
      if (b != null && sl != null) parts.push(`In the last hour, ${b.toLocaleString()} buys and ${sl.toLocaleString()} sells.`);
      if (recent.length) parts.push(`${recent.length} trades in the last five minutes.`);
      if (m?.volume_1h_usd != null) parts.push(`Volume this hour is about ${usd(m.volume_1h_usd)}.`);
      return parts.length ? parts.join(" ") : "I don't have trade counts for this coin.";
    }],
    [/price|market cap|mcap|\bmc\b|chart|trend|pumping|dumping|moving|momentum|going up|going down/, () => {
      const parts: string[] = [];
      if (c.mcUsd != null) parts.push(`Market cap is ${usd(c.mcUsd)}.`);
      const ch5 = m?.change_5m_pct ?? c.change5m;
      const ch1 = m?.change_1h_pct ?? c.change1h;
      const moves = [ch5 != null ? `${ch5 >= 0 ? "up" : "down"} ${pctWord(ch5)} in five minutes` : null, ch1 != null ? `${ch1 >= 0 ? "up" : "down"} ${pctWord(ch1)} in the hour` : null].filter(Boolean);
      if (moves.length) parts.push(`It's ${moves.join(", and ")}.`);
      return parts.length ? parts.join(" ") : "I don't have price data right now.";
    }],
    [/liquidity|\bpool\b/, () => (c.liquidityUsd != null ? `Liquidity is about ${usd(c.liquidityUsd)}.` : m && !m.complete ? `It's still on the bonding curve, ${r0(m.curve_progress)} percent of the way to graduating.` : "I don't have liquidity data for this coin.")],
    [/curve|graduat|bonding/, () => (m ? (m.complete ? "It already graduated to a normal pool." : `It's ${r0(m.curve_progress)} percent along the bonding curve.`) : "I don't have curve data for this coin.")],
    [/how old|\bage\b|launched|when did it/, () => (c.ageSecs != null ? `It launched about ${age(c.ageSecs)} ago.` : "I don't know when it launched.")],
    [/\bai\b|predict|chance|crash|double|forecast|score|safety/, () => {
      const parts: string[] = [];
      if (c.risk) parts.push(`Kixo AI gives it ${aPct(c.risk.dump * 100)} chance to crash and ${aPct(c.risk.pump * 100)} chance to double within the hour.`);
      if (c.buyScore != null) parts.push(`The Kixo Buy Score is ${c.buyScore} out of 100.`);
      if (c.safety) parts.push(`The safety score is ${c.safety.score} out of 100.`);
      return parts.length ? parts.join(" ") : "Kixo AI hasn't scored this one. It scores new coins after their first two minutes.";
    }],
    [/next (minute|min|two|2|few|five|5)|short term|scalp|will it (pump|go up|moon|dump|drop)|going to (pump|dump)|right now|momentum/, () => {
      const sc = c.scalp;
      if (!sc) return m && m.complete ? "My next-minutes model only reads coins on their launch curve. This one already graduated." : "I don't have a next-minutes read on this one yet. Give it a few seconds.";
      return `In the next minute, ${aPct(sc.up10_1m * 100)} chance it's up 10 percent. In two minutes, ${aPct(sc.up20_2m * 100)} chance of plus 20 and ${aPct(sc.down15_2m * 100)} chance of minus 15. ${scalpRead(sc) === "hot" ? "That's a good scalp setup." : scalpRead(sc) === "weak" ? "Momentum is weak right now." : "No clear edge right now."}`;
    }],
    [/what happen|recap|summary|what's new|update|going on/, () => {
      const recent = c.trades.filter((x) => x.ts >= Date.now() / 1000 - 120);
      const b = recent.filter((x) => x.is_buy).length;
      const dev = recent.some((x) => x.dev && !x.is_buy);
      return recent.length ? `In the last two minutes, ${b} buys and ${recent.length - b} sells.${dev ? " The dev sold in that time." : ""} ${momentum(c, mode) ?? ""}`.trim() : "It's quiet. No trades in the last two minutes.";
    }],
  ];
  const facts = topics.filter(([re]) => re.test(t)).slice(0, 3).map(([, fn]) => fn());

  // The user's own trading on this coin.
  if (/what (did|have) i (do|done|buy|bought|trade)|my trades|my history|how much (did|have) i (make|made|lose|lost)|what's my (profit|pnl)/.test(t)) return tradesStory(c.myTrades, c.position, S);
  if (/enough|good profit|take (my )?profit|is it time|keep (it|holding)|hold or sell|sell or hold/.test(t)) return enoughAnswer(c.position, S, c.scalp);

  // Advice: selling what they hold, or buying.
  const sellQ = /(should|do|can) i sell|when (to|do i|should i) sell|sell (it|now|mine|my)|take profit|get out|\bexit\b|cut (it|my|losses)|dump my/.test(t);
  const buyQ = /should i (buy|ape|get in|enter)|buy (it|now|this)|\bape\b|worth (it|buying)|is it (safe|good|bad|a rug|legit)|\brug\b|scam|legit|your (take|read|call)|what do you think|thoughts|how risky|\brisk\b|good (buy|coin)/.test(t);
  if (sellQ) {
    const call = callOf(c.plan);
    const p = c.position;
    let adv: string;
    if (!p || p.valueUsd == null) adv = `You don't hold ${S}, so there's nothing to sell.`;
    else {
      const pc = (p.valueUsd / p.costUsd - 1) * 100;
      if (call === "avoid") adv = `I'd sell. ${brief(c, mode === "quiet" ? "buddy" : mode) ?? ""}`.trim();
      else if (pc >= 50) adv = `You're up ${pctWord(pc)}. Taking at least half off the table here is a smart move.`;
      else if (pc <= -25) adv = `You're down ${pctWord(pc)}. If the reason you bought is gone, cutting it now saves you from a bigger loss.`;
      else adv = "Nothing says sell right now. Keep a stop loss in place and I'll warn you if the dev or the whales start selling.";
    }
    return [adv, ...facts].join(" ");
  }
  if (buyQ || (!facts.length && /buy|good|bad|safe/.test(t))) {
    return [brief(c, mode === "quiet" ? "buddy" : mode) ?? `I don't have enough data on ${S} yet. Give it a minute.`, ...facts].join(" ");
  }
  if (facts.length) return facts.join(" ");
  for (const [re, ans] of GLOSSARY) if (re.test(t)) return ans;
  return pick(["I didn't catch that. Ask me about the dev, holders, trades, the risk, or if you should buy.", "Not sure what you mean. Try asking if you should buy, or what the dev is doing."], q);
}
