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

type Reason = { weight: number; good: boolean; text: string; explain?: string };

function reasons(c: CoinCtx): Reason[] {
  const out: Reason[] = [];
  const m = c.market;
  if (m?.dev_sold_all) out.push({ weight: 10, good: false, text: "the dev already sold everything", explain: "When the creator sells out, there's usually no one left to push the price." });
  else if (m && m.dev_sells > 0) out.push({ weight: 8, good: false, text: `the dev has started selling and still holds ${pctWord(m.dev_pct)}`, explain: "A creator who sells often keeps selling." });
  if (c.risk && c.risk.dump >= 0.4) out.push({ weight: 9, good: false, text: `Kixo AI gives it ${aPct(c.risk.dump * 100)} chance to crash within the hour` });
  if (c.devReport && c.devReport.rugged > 0) out.push({ weight: 7, good: false, text: `this dev rugged ${c.devReport.rugged} of ${c.devReport.coins} earlier coins` });
  const bundles = m?.bundle_pct ?? null;
  if (bundles != null && bundles >= 10) out.push({ weight: 6, good: false, text: `bundled wallets still hold ${pctWord(bundles)}`, explain: "Bundles are wallets that bought together at launch, often the dev's own. They can dump all at once." });
  const top10 = m?.top10_pct ?? c.top10Pct;
  if (top10 != null && top10 > 30) out.push({ weight: 5, good: false, text: `the top ten wallets hold ${pctWord(top10)}`, explain: "When a few wallets hold a lot, they can move the price hard when they sell." });
  const snipers = m?.sniper_pct ?? c.sniperPct;
  if (snipers != null && snipers >= 10) out.push({ weight: 5, good: false, text: `snipers who bought in the first seconds still hold ${pctWord(snipers)}`, explain: "Snipers are bots that buy at launch and sell into the first pump." });
  const holders = m?.holders ?? c.holders;
  if (holders != null && holders < 20 && (c.ageSecs ?? 0) > 120) out.push({ weight: 4, good: false, text: `only ${holders} wallets hold it` });
  const flow = (c.buys1h ?? m?.buys_1h ?? 0) + (c.sells1h ?? m?.sells_1h ?? 0);
  const buys = c.buys1h ?? m?.buys_1h ?? 0;
  const sells = c.sells1h ?? m?.sells_1h ?? 0;
  if (flow >= 30 && sells > buys * 1.5) out.push({ weight: 4, good: false, text: `sellers are winning, ${sells} sells against ${buys} buys this hour` });
  if (c.liquidityUsd != null && c.liquidityUsd < 5000 && (m == null || m.complete)) out.push({ weight: 4, good: false, text: `liquidity is thin, about ${money(c.liquidityUsd)}` });
  // Good signs.
  if (m && !m.dev_sold_all && m.dev_sells === 0 && (c.ageSecs ?? 0) > 120) out.push({ weight: 4, good: true, text: "the dev hasn't sold anything" });
  if (top10 != null && top10 <= 20 && (holders ?? 0) >= 50) out.push({ weight: 4, good: true, text: `holders are spread out, the top ten hold just ${pctWord(top10)}` });
  if (flow >= 30 && buys > sells * 1.5) out.push({ weight: 4, good: true, text: `buyers are in control, ${buys} buys against ${sells} sells this hour` });
  if (c.risk && c.risk.dump < 0.15) out.push({ weight: 5, good: true, text: c.risk.dump < 0.01 ? "Kixo AI sees almost no crash risk" : `Kixo AI sees a low crash risk, about ${pctWord(c.risk.dump * 100)}` });
  if (c.devReport && c.devReport.graduated > 0 && c.devReport.rugged === 0) out.push({ weight: 3, good: true, text: `this dev graduated ${c.devReport.graduated} coins before and never rugged` });
  for (const f of c.findings) {
    if (f.tone === "good" && /proven/.test(f.text)) out.push({ weight: 4, good: true, text: f.text.replace(/\.$/, "").replace(/^(\d+) proven profitable traders? holds?/, (_, n) => `${n} proven profitable trader${n === "1" ? " holds" : "s hold"}`) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The move right now, when it matters. */
function momentum(c: CoinCtx, mode: AgentMode): string | null {
  const ch = c.market?.change_5m_pct ?? c.change5m;
  if (ch == null || Math.abs(ch) < 15) return null;
  const up = ch > 0;
  if (mode === "pro") return `${up ? "Up" : "Down"} ${pctWord(ch)} in five minutes.`;
  if (mode === "degen") return up ? `It's sending, up ${pctWord(ch)} in five minutes.` : `It's bleeding, down ${pctWord(ch)} in five minutes.`;
  return `Right now it's ${up ? "up" : "down"} ${pctWord(ch)} in the last five minutes.`;
}

/** What to do, from the plan's own levels. */
function action(c: CoinCtx, call: Call, mode: AgentMode): string | null {
  const own = c.position && c.position.valueUsd != null;
  if (call === "avoid") {
    if (own) return mode === "pro" ? "You hold it. Consider selling into the next bounce." : "You're holding some. I'd sell on the next small bounce.";
    return mode === "coach" ? "There are new coins every minute, so there's no need to force this one." : null;
  }
  if (call === "wait_young" || call === "wait_falling" || call === "too_late") {
    if (own && call === "too_late") return mode === "pro" ? "If you hold it, take some profit." : "If you're holding, this is a good moment to take some profit.";
    return null;
  }
  const stop = call === "ok_small" ? 25 : call === "risky" ? 20 : call === "recommend" ? 40 : 20;
  const size = call === "risky" ? "about one percent" : "one to three percent";
  if (mode === "pro") return `Size ${size} of balance. Stop at minus ${stop}.`;
  if (mode === "degen") return `Keep it to ${size} of your stack and cut it at minus ${stop} percent. No hero bags.`;
  if (mode === "coach") return `If you buy, use only ${size} of your balance, and sell if it drops ${stop} percent. That way one bad coin can't hurt you much.`;
  return `If you go in, keep it to ${size} of your balance and get out if it drops ${stop} percent.`;
}

/** The read when a coin's page opens. Null while there is too little data to say anything. */
export function brief(c: CoinCtx, mode: AgentMode): string | null {
  if (mode === "quiet") return null;
  const call = callOf(c.plan);
  if (!call) return null;
  const S = c.symbol || "this coin";
  const lines: string[] = [pick(CALLS[call][mode], `${S}${call}`).replace("{S}", S)];
  const rs = reasons(c);
  const negative = call === "avoid" || call === "risky" || call === "skip" || call === "wait_falling";
  const bad = rs.filter((r) => !r.good);
  const good = rs.filter((r) => r.good);
  const plain = mode === "pro" || mode === "degen";
  if (negative) {
    const list = bad.slice(0, mode === "pro" ? 1 : 2);
    if (list.length) {
      const joined = list.length === 2 ? `${list[0].text}, and ${list[1].text}` : list[0].text;
      lines.push(plain ? `${cap(joined)}.` : `${pick(["The main thing is", "Here's why:", "Why? Well,"], S)} ${joined}.`);
      if (mode === "coach" && list[0].explain) lines.push(list[0].explain);
    } else if (c.plan?.sub) {
      // No single red flag stands out: the plan's own reason (the forecast, too few holders...).
      lines.push(`${c.plan.sub.replace(/\.$/, "")}.`);
    }
  } else {
    if (good[0]) lines.push(plain ? `${cap(good[0].text)}.` : `${pick(["On the plus side,", "Good news,", "What I like:"], S)} ${good[0].text}.`);
    if (bad[0] && mode !== "pro") lines.push(plain ? `Watch out though, ${bad[0].text}.` : `${pick(["Just know that", "The risk is", "One thing to watch:"], S)} ${bad[0].text}.`);
    if (!good[0] && !bad[0] && c.plan?.sub) lines.push(`${c.plan.sub.replace(/\.$/, "")}.`);
    if (mode === "coach" && bad[0]?.explain) lines.push(bad[0].explain);
  }
  const mom = momentum(c, mode);
  if (mom && call !== "wait_falling" && call !== "too_late") lines.push(mom);
  const act = action(c, call, mode);
  if (act) lines.push(act);
  return lines.join(" ");
}

/* ---------------- Live alerts ---------------- */

export type Alert = { kind: AlertKind; text: string; urgent: boolean };

const ALERT_TEXT: Record<AlertKind, Record<Exclude<AgentMode, "quiet"> | "quiet", (x: string) => string>> = {
  dev: {
    buddy: (x) => `Heads up! The dev just sold ${x}.`,
    coach: (x) => `Warning: the creator just sold ${x}. That's often a sign the price will drop.`,
    pro: (x) => `Dev sold ${x}.`,
    degen: (x) => `Dev just dumped ${x}. Not bullish.`,
    quiet: (x) => `Warning. The dev just sold ${x}.`,
  },
  dump: {
    buddy: (x) => `Careful, it's dumping. ${x}`,
    coach: (x) => `The price is falling fast. ${x} Don't panic buy the dip.`,
    pro: (x) => `Dump. ${x}`,
    degen: (x) => `It's nuking. ${x}`,
    quiet: (x) => `Warning. ${x}`,
  },
  whale: {
    buddy: (x) => `A whale just sold ${x}.`,
    coach: (x) => `A big holder just sold ${x}. Big sells can push the price down.`,
    pro: (x) => `Whale sold ${x}.`,
    degen: (x) => `Whale just dumped ${x} on everyone.`,
    quiet: (x) => `A whale just sold ${x}.`,
  },
  bundles: {
    buddy: (x) => `The bundle wallets are selling. ${x}`,
    coach: (x) => `Wallets that bought together at launch are selling now. ${x} They're often the dev's own wallets.`,
    pro: (x) => `Bundles selling. ${x}`,
    degen: (x) => `Bundles are exiting. ${x} Classic.`,
    quiet: (x) => `Bundle wallets are selling. ${x}`,
  },
  pump: {
    buddy: (x) => `Whoa, it's ripping. ${x}`,
    coach: (x) => `The price is jumping fast. ${x} Remember, buying after a big jump is risky.`,
    pro: (x) => `Pump. ${x}`,
    degen: (x) => `It's sending! ${x}`,
    quiet: (x) => `${x}`,
  },
  position: {
    buddy: (x) => x,
    coach: (x) => x,
    pro: (x) => x,
    degen: (x) => x,
    quiet: (x) => x,
  },
};

/** Watches a coin's live trades for what is worth interrupting for. Lines are spoken at
 *  most once per kind in a while, so the agent never nags. */
export class Watcher {
  private seen = new Set<string>();
  private primed = false;
  private last: Partial<Record<AlertKind, number>> = {};
  private lastAny = 0;
  private bundleSells: number[] = [];
  private posFlags = { down: false, up: false };

  constructor(readonly mint: string) {}

  check(c: CoinCtx, s: AgentSettings, now: number): Alert[] {
    const fresh = c.trades.filter((t) => !this.seen.has(t.signature));
    fresh.forEach((t) => this.seen.add(t.signature));
    if (!this.primed) {
      // The trades already on screen are history, not news.
      this.primed = true;
      return [];
    }
    const out: Alert[] = [];
    const mode = s.mode;
    const allow = (k: AlertKind, gap: number) => s.alerts[k] && now - (this.last[k] ?? 0) > gap * 1000;
    const add = (k: AlertKind, text: string, urgent: boolean) => {
      out.push({ kind: k, text, urgent });
    };
    const value = (solAmt: number) => (c.solUsd ? `${sol(solAmt)}, about ${usd(solAmt * c.solUsd)}` : sol(solAmt));

    // The creator selling.
    const devSells = fresh.filter((t) => t.dev && !t.is_buy);
    if (devSells.length && allow("dev", 20)) {
      const amt = devSells.reduce((a, t) => a + t.sol, 0);
      const all = c.market?.dev_sold_all;
      add("dev", all ? ALERT_TEXT.dev[mode](`everything, ${value(amt)}`) : ALERT_TEXT.dev[mode](value(amt)), true);
    }
    // A whale leaving.
    const mcSol = c.trades[0]?.mc_sol ?? 0;
    const big = Math.max(5, mcSol * 0.002);
    const whale = fresh.filter((t) => !t.is_buy && !t.dev && t.sol >= big).sort((a, b) => b.sol - a.sol)[0];
    if (whale && allow("whale", 30)) add("whale", ALERT_TEXT.whale[mode](value(whale.sol)), whale.sol >= big * 3);
    // Bundles selling (two or more sells within a minute).
    fresh.filter((t) => t.bundler && !t.is_buy).forEach(() => this.bundleSells.push(now));
    this.bundleSells = this.bundleSells.filter((x) => now - x < 60_000);
    if (this.bundleSells.length >= 2 && allow("bundles", 60)) add("bundles", ALERT_TEXT.bundles[mode](mode === "pro" ? "" : "Watch out."), true);
    // Fast moves over the last minute, from the trades' market caps.
    const minute = c.trades.filter((t) => t.ts >= now / 1000 - 60);
    if (minute.length >= 5) {
      const latest = minute[0].mc_sol;
      const high = Math.max(...minute.map((t) => t.mc_sol));
      const low = Math.min(...minute.map((t) => t.mc_sol));
      const sells = minute.filter((t) => !t.is_buy).length;
      const drop = high > 0 ? (1 - latest / high) * 100 : 0;
      const rise = low > 0 ? (latest / low - 1) * 100 : 0;
      if (drop >= 20 && sells > minute.length / 2 && allow("dump", 60)) add("dump", ALERT_TEXT.dump[mode](`Down ${pctWord(drop)} in the last minute.`), drop >= 35);
      else if (rise >= 30 && allow("pump", 90)) add("pump", ALERT_TEXT.pump[mode](`Up ${pctWord(rise)} in the last minute.`), false);
    }
    // The user's own position.
    const p = c.position;
    if (p && p.valueUsd != null && p.costUsd > 0 && s.alerts.position) {
      const pnl = (p.valueUsd / p.costUsd - 1) * 100;
      if (pnl <= -25 && !this.posFlags.down) {
        this.posFlags.down = true;
        add("position", mode === "pro" ? `Your position is down ${pctWord(pnl)}.` : `You're down ${pctWord(pnl)} on this one. Think about cutting it before it gets worse.`, true);
      } else if (pnl >= 50 && !this.posFlags.up) {
        this.posFlags.up = true;
        add("position", mode === "pro" ? `Your position is up ${pctWord(pnl)}.` : `Nice, you're up ${pctWord(pnl)}. Taking some profit here would be smart.`, false);
      }
      if (pnl > -15) this.posFlags.down = false;
      if (pnl < 30) this.posFlags.up = false;
    }
    // One line at a time, the most urgent first; ordinary lines at most every 8 seconds.
    out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    const top = out[0];
    if (!top || (!top.urgent && now - this.lastAny < 8000)) return [];
    this.last[top.kind] = now;
    this.lastAny = now;
    return [top];
  }
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
    [/what happen|recap|summary|what's new|update|going on/, () => {
      const recent = c.trades.filter((x) => x.ts >= Date.now() / 1000 - 120);
      const b = recent.filter((x) => x.is_buy).length;
      const dev = recent.some((x) => x.dev && !x.is_buy);
      return recent.length ? `In the last two minutes, ${b} buys and ${recent.length - b} sells.${dev ? " The dev sold in that time." : ""} ${momentum(c, mode) ?? ""}`.trim() : "It's quiet. No trades in the last two minutes.";
    }],
  ];
  const facts = topics.filter(([re]) => re.test(t)).slice(0, 3).map(([, fn]) => fn());

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
