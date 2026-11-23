"use client";
/* Ask Kixo AI: answers from Kixo's own live data and model, in the browser. No outside
   language model sees the question, and nothing is made up: every coin figure comes from
   the radar feed or the AI's score, and every explanation is written here. English and
   Roman Urdu questions both work. A language model can replace `answer` later. */
import { GATEWAY_HTTP, usd, type FeedToken, type MarketToken } from "./gateway";
import { pct, verdict, type AiRisk, type Verdict } from "./ai-risk";
import { safetyScore, type Safety } from "./safety";

const ADVICE: Record<Verdict["key"], string> = {
  danger: "Best to stay away. If you still buy, keep it tiny and set a tight stop loss",
  careful: "If you buy, keep it small and set a stop loss",
  calm: "No strong signal. Let the trades and holders tell you more before buying",
  good: "Worth a look. It is still a memecoin: buy small and set a stop loss",
};

/** safety: Kixo's safety score, given when there is no AI word (older coins). */
export type ChatCoin = { mint: string; symbol: string; image: string | null; risk: AiRisk | null; line: string; safety?: Safety | null };
export type ChatReply = { text: string[]; coins?: ChatCoin[]; suggestions?: string[] };
export type ChatContext = { tokens: FeedToken[]; overview: AiOverview | null; nowSecs: number };
export type ChatInput = Omit<ChatContext, "nowSecs">;

type Pick = { mint: string; symbol: string | null; image: string | null; mc_usd: number | null; dump: number; pump: number; at: number };
type Group = { coins: number; dumped: number | null; doubled: number | null };
export type AiOverview = {
  riskiest?: Pick[];
  best?: Pick[];
  track?: { all: Group; high_dump: Group; low_dump: Group; high_pump: Group };
  model?: { coins: number | null; targets: { dump: { base_rate: number; top10pct_rate: number; bottom10pct_rate: number }; pump: { base_rate: number; top10pct_rate: number } } | null } | null;
};

/** A seed phrase, private key or key file: answered here and never sent anywhere
 *  (the gateway checks too, ai_chat.rs). */
export function looksSecret(msg: string) {
  const words = msg.trim().split(/\s+/);
  if ([12, 15, 18, 21, 24].includes(words.length) && words.every((w) => /^[a-z]{3,8}$/.test(w))) return true;
  if (/(^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{80,90}($|[^1-9A-HJ-NP-Za-km-z])/.test(msg)) return true;
  return (msg.match(/,/g)?.length ?? 0) >= 31 && /^[\s\d,[\]]+$/.test(msg);
}

export const SECRET_REPLY: ChatReply = {
  text: [
    "Stop: that looks like a seed phrase or private key. I did not send it anywhere",
    "Never share it with anyone, including Kixo, support or any bot. Anyone who asks for it is a scammer",
    "If you already shared it somewhere, move your funds to a new wallet now",
  ],
  suggestions: ["How do I keep my wallet safe?", "Best coins right now"],
};

/** Model replies as plain text: markdown marks would show as stray symbols. */
export const plain = (t: string) =>
  t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");

/** Asks Kixo AI's language model through the gateway. null = answer from Kixo's own data. */
export async function askModel(message: string, history: { role: "user" | "assistant"; content: string }[]): Promise<{ reply: string } | { refused: true } | null> {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, history }),
      signal: AbortSignal.timeout(45_000),
    });
    const v = (await r.json()) as { reply?: string; refused?: string; fallback?: boolean };
    if (v.refused) return { refused: true };
    return v.reply ? { reply: v.reply } : null;
  } catch {
    return null;
  }
}

export const STARTERS =["Best coins right now", "Which coins may rug?", "Is the AI accurate?", "What are bundles?", "Copy Kixo AI kya hai?"];

const MINT = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

const GLOSSARY: { keys: RegExp; title: string; text: string }[] = [
  { keys: /bundl/, title: "Bundles", text: "Wallets that bought together in the same block right after launch. Often one person splitting a big buy across many wallets to look like demand. Kixo shows the share they still hold: a high share can be dumped all at once" },
  { keys: /snip|early buyer/, title: "Snipers and early buyers", text: "Wallets that bought in the first 3 seconds, usually bots. If they still hold a big share, they can sell into the first buyers. Kixo's Sniper is different: your own rule-based auto-buyer" },
  { keys: /\bdev\b|creator|developer/, title: "Dev (creator)", text: "The wallet that created the coin. Kixo shows how much it holds, whether it is selling, and its history: how many earlier coins it rugged, how many died fast and how many graduated" },
  { keys: /top ?10|holder/, title: "Top 10 and holders", text: "Top 10 is the share held by the 10 largest wallets. Above about 30% a few wallets can move the price hard. More real holders spread the risk" },
  { keys: /curve|graduat|bonding/, title: "Bonding curve and graduation", text: "New pump.fun coins trade on a curve: the price rises as people buy. At 100% the coin graduates to a normal pool (PumpSwap). Most coins never graduate" },
  { keys: /\brug|rugpull|rug pull/, title: "Rug pull", text: "The creator or insiders sell everything at once and the price collapses. Signs: dev selling, high bundles, a dev with earlier rugs, few real holders. Kixo AI's dump risk estimates the chance of a 70%+ fall in the next hour" },
  { keys: /dump risk|dump/, title: "Dump risk", text: "Kixo AI's chance that a coin falls 70% or more within the hour after its first 2 minutes. It is measured from the price at 2 minutes" },
  { keys: /2x|odds|double/, title: "2x odds", text: "Kixo AI's chance that a coin doubles from its price at 2 minutes within the next hour. Few coins do: about 5 in 100 on average" },
  { keys: /market ?cap|\bmc\b/, title: "Market cap", text: "Price times supply: what the whole coin is worth at the current price. Small caps move fast both ways" },
  { keys: /liquidity/, title: "Liquidity", text: "Money in the pool that trades the coin. Low liquidity means big price impact: a small buy or sell moves the price a lot" },
  { keys: /slippage|price impact/, title: "Slippage", text: "How far the price you get can move from the quote. On thin memecoins keep it moderate; Kixo shows the real cost of each trade before you confirm" },
  { keys: /mint authority|freeze/, title: "Mint and freeze authority", text: "If the mint authority is active, more tokens can be created; if freeze is active, wallets can be frozen. Pump.fun coins have both revoked at creation" },
  { keys: /safety score|safety/, title: "Safety score", text: "Kixo's 0 to 100 score from 25+ checks: contract, dev, holders, bundles, copies, socials, bot trading and more. Higher is safer, never risk free" },
  { keys: /stop ?loss|take ?profit|\btp\b|\bsl\b|trailing/, title: "Take profit, stop loss, trailing", text: "Take profit sells at your target gain, stop loss sells at your max loss, a trailing stop sells when the price falls a set amount from its best. On memecoins a stop loss is the most important rule" },
  { keys: /smart money|copy trad/, title: "Smart Money and copy trading", text: "Smart Money are real wallets that keep taking profit on new coins. Copy trading follows one wallet's buys and sells on your demo account first" },
  { keys: /\bdemo\b|paper/, title: "Demo account", text: "Virtual $10,000 traded at live prices with real fees and price impact, so results match real trading. Learn there first" },
];

const has = (q: string, re: RegExp) => re.test(q);

function age(nowSecs: number, ts: number) {
  const s = Math.max(0, Math.round(nowSecs - ts));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

async function scoreOf(mint: string): Promise<{ risk: AiRisk | null; waiting: boolean }> {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/ai/risk?mints=${mint}`, { cache: "no-store" });
    const v = (await r.json()) as { risk?: Record<string, AiRisk>; waiting?: number };
    return { risk: v.risk?.[mint] ?? null, waiting: (v.waiting ?? 0) > 0 };
  } catch {
    return { risk: null, waiting: false };
  }
}

/** The gateway's market record for any coin (older ones too), with its dev's launch counts. */
type CoinInfo = MarketToken & { dev?: string | null; dev_pct?: number | null; dev_mints?: number | null; dev_migrations?: number | null };

async function infoOf(mint: string): Promise<CoinInfo | null> {
  try {
    const r = await fetch(`${GATEWAY_HTTP}/token/${mint}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const v = r.ok ? ((await r.json()) as CoinInfo | null) : null;
    return v?.mint ? v : null;
  } catch {
    return null;
  }
}

const signed = (v: number) => `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}%`;

function ageOf(iso: string | null, nowSecs: number) {
  if (!iso) return null;
  const s = nowSecs - Date.parse(iso) / 1000;
  if (!Number.isFinite(s) || s < 0) return null;
  return s < 3600 ? `${Math.floor(s / 60)}m` : s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`;
}

/** A coin that is no longer on Sol Radar: its market figures, Kixo's safety score and
 *  the red flags it found, all from the gateway's record of the coin. */
function marketReport(c: CoinInfo, nowSecs: number): { text: string[]; safety: Safety; line: string } {
  const created = c.created_at ? Date.parse(c.created_at) / 1000 : null;
  const safety = safetyScore({
    mintRevoked: c.mint_authority_disabled,
    freezeRevoked: c.freeze_authority_disabled,
    top10Pct: c.top_holders_pct,
    devPct: c.dev_pct ?? null,
    devSoldAll: null,
    devSelling: null,
    devReport: null,
    bundlePct: null,
    earlyPct: null,
    copyOfReal: false,
    sameXAccount: false,
    sameSymbol: false,
    hasSocials: !!(c.twitter || c.telegram || c.website),
    buys1h: c.buys_1h,
    sells1h: c.sells_1h,
    change5m: c.change_5m_pct,
    change1h: c.change_1h_pct,
    liquidityUsd: c.liquidity_usd,
    holders: c.holders,
    ageSecs: created != null && Number.isFinite(created) ? nowSecs - created : null,
    organicScore: c.organic_score,
    smartHolders: 0,
    verified: c.verified,
  });
  const text: string[] = [];
  const age = ageOf(c.created_at, nowSecs);
  text.push(
    `${c.symbol}${c.name && c.name !== c.symbol ? ` (${c.name})` : ""}: ${age ? `${age} old, ` : ""}market cap ${usd(c.mc_usd)}, liquidity ${usd(c.liquidity_usd)}${c.holders != null ? `, ${c.holders.toLocaleString()} holders` : ""}`,
  );
  const moves = [
    c.change_5m_pct != null ? `5m ${signed(c.change_5m_pct)}` : null,
    c.change_1h_pct != null ? `1h ${signed(c.change_1h_pct)}` : null,
    c.change_24h_pct != null ? `24h ${signed(c.change_24h_pct)}` : null,
  ].filter(Boolean);
  if (moves.length) text.push(`Price: ${moves.join(", ")}${c.volume_1h_usd != null ? `. Volume ${usd(c.volume_1h_usd)} in the last hour` : ""}`);
  if (c.buys_1h != null && c.sells_1h != null) {
    text.push(`Last hour: ${c.buys_1h.toLocaleString()} buys and ${c.sells_1h.toLocaleString()} sells${c.traders_1h != null ? ` from ${c.traders_1h.toLocaleString()} traders` : ""}`);
  }
  const holds = [
    c.top_holders_pct != null ? `top 10 hold ${c.top_holders_pct.toFixed(0)}%` : null,
    c.dev_pct != null ? `dev holds ${c.dev_pct.toFixed(1)}%` : null,
    c.organic_score != null ? `organic score ${c.organic_score.toFixed(0)}` : null,
  ].filter(Boolean);
  if (holds.length) text.push(`Holders: ${holds.join(", ")}`);
  text.push(
    `Contract: mint authority ${c.mint_authority_disabled ? "revoked" : "active (more can be created)"}, freeze ${c.freeze_authority_disabled === false ? "active (wallets can be frozen)" : c.freeze_authority_disabled ? "revoked" : "unknown"}`,
  );
  if (c.dev_mints != null && c.dev_mints > 0) {
    text.push(`Dev: made ${c.dev_mints} coins, ${c.dev_migrations ?? 0} of them graduated${c.dev_mints >= 10 && (c.dev_migrations ?? 0) <= 1 ? ". A serial launcher: most of its coins went nowhere" : ""}`);
  }
  const flags = safety.factors.filter((f) => f.points <= -8).slice(0, 4);
  if (flags.length) text.push(`Watch out: ${flags.map((f) => (f.detail ? `${f.label.toLowerCase()} (${f.detail})` : f.label.toLowerCase())).join(", ")}`);
  const line = `${usd(c.mc_usd)} · ${c.holders != null ? `${c.holders.toLocaleString()} holders` : "holders unknown"}${c.launchpad ? ` · ${c.launchpad}` : ""}`;
  return { text, safety, line };
}

/** A coin's report: live facts from the radar, the AI's score, and a plain verdict. */
async function coinReport(mint: string, ctx: ChatContext): Promise<ChatReply> {
  const t = ctx.tokens.find((x) => x.mint === mint) ?? null;
  const [{ risk, waiting }, info] = await Promise.all([scoreOf(mint), t ? Promise.resolve(null) : infoOf(mint)]);
  if (!t && info && !risk) {
    const r = marketReport(info, ctx.nowSecs);
    r.text.push("No Kixo AI word: it judges new coins from their first 2 minutes, so older coins get Kixo's safety score instead");
    return {
      text: r.text,
      coins: [{ mint, symbol: info.symbol || mint.slice(0, 6), image: info.image, risk: null, line: r.line, safety: r.safety }],
      suggestions: ["Best coins right now", "Which coins may rug?", "What is a rug pull?"],
    };
  }
  const sym = t?.symbol || info?.symbol || mint.slice(0, 6);
  const text: string[] = [];
  const m = t?.market;
  if (t) {
    text.push(`${sym}${t.name ? ` (${t.name})` : ""}: ${age(ctx.nowSecs, t.timestamp)} old${m ? `, market cap ${usd(m.mc_usd)}, ${m.holders} holders, ${m.trades_total} trades` : ""}`);
    if (m) {
      const flags: string[] = [];
      if (m.dev_sold_all) flags.push("the dev sold everything");
      else if (m.dev_sells > 0) flags.push(`the dev sold ${m.dev_sells} times`);
      if (m.top10_pct > 30) flags.push(`top 10 hold ${m.top10_pct.toFixed(0)}%`);
      if (m.bundle_pct > 20) flags.push(`bundles still hold ${m.bundle_pct.toFixed(0)}%`);
      if (m.sniper_pct > 10) flags.push(`early buyers hold ${m.sniper_pct.toFixed(0)}%`);
      text.push(flags.length ? `Watch out: ${flags.join(", ")}` : `Holders look spread: top 10 ${m.top10_pct.toFixed(0)}%, dev ${m.dev_pct.toFixed(0)}%, bundles ${m.bundle_pct.toFixed(0)}%`);
    }
    const d = t.dev_report;
    if (d) text.push(d.coins === 0 ? "New dev: no earlier coins seen" : `Dev history: ${d.coins} earlier coins, ${d.rugged} rugged, ${d.died_fast} died fast, ${d.graduated} graduated`);
  } else if (info) {
    text.push(...marketReport(info, ctx.nowSecs).text);
  } else {
    text.push(`${sym}: Kixo has no market data on this coin. Check the address, or it may have no pool yet`);
  }
  if (risk) {
    const v = verdict(risk);
    text.unshift(`Kixo AI says: ${v.label}. ${v.sentence}`);
    text.push(ADVICE[v.key]);
    text.push(`Crash chance ${pct(risk.dump)}, double chance ${pct(risk.pump)}, judged from its first 2 minutes`);
  } else if (waiting) {
    text.push("Kixo AI scores it once its first 2 minutes are over. Ask me again shortly");
  } else {
    text.push("No AI score: Kixo scores the coins it saw launch, from their first 2 minutes");
  }
  return {
    text,
    coins: [{ mint, symbol: sym, image: t?.meta?.image ?? info?.image ?? null, risk, line: m ? `${usd(m.mc_usd)} · ${m.holders} holders` : info ? `${usd(info.mc_usd)} · ${info.holders ?? "?"} holders` : "" }],
    suggestions: ["Best coins right now", "Which coins may rug?", "What is dump risk?"],
  };
}

const pickCoin = (p: Pick, nowSecs: number): ChatCoin => ({
  mint: p.mint,
  symbol: p.symbol || p.mint.slice(0, 6),
  image: p.image,
  risk: { dump: p.dump, pump: p.pump, trades: 0, at: p.at },
  line: `${usd(p.mc_usd)} · scored ${age(nowSecs, p.at)} ago`,
});

export async function answer(input: string, given: ChatInput): Promise<ChatReply> {
  const ctx: ChatContext = { ...given, nowSecs: Date.now() / 1000 };
  const raw = input.trim();
  const q = raw.toLowerCase();
  if (!q) return { text: ["Ask me about a coin, the best or riskiest coins right now, or any trading word"], suggestions: STARTERS };

  // A coin address, or a symbol on the radar ("$PEPE", "pepe kaisa hai").
  const mint = raw.match(MINT)?.[0];
  if (mint) return coinReport(mint, ctx);
  const words = new Set(q.replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).map((w) => w.replace(/^\$/, "")).filter((w) => w.length >= 2));
  const dollar = raw.match(/\$([A-Za-z0-9]{2,12})/)?.[1]?.toLowerCase();
  const bySymbol = ctx.tokens
    .filter((t) => (dollar ? t.symbol.toLowerCase() === dollar : words.has(t.symbol.toLowerCase()) && t.symbol.length >= 3))
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const termAsked = GLOSSARY.find((g) => g.keys.test(q));
  const askingMeaning = has(q, /what (is|are|does)|what's|meaning|matlab|kya (hai|hota|hoti|hain)|explain|samjha/);
  if (bySymbol && !(termAsked && askingMeaning)) return coinReport(bySymbol.mint, ctx);

  const o = ctx.overview;
  if (termAsked && (askingMeaning || q.split(/\s+/).length <= 3)) {
    return { text: [`${termAsked.title}: ${termAsked.text}`], suggestions: ["Best coins right now", "Which coins may rug?", "Is the AI accurate?"] };
  }

  if (has(q, /wallet (safe|secure|security)|keep (my )?wallet|seed phrase|private key|phishing|hack|drain|wallet ko (safe|mehfooz)|security/)) {
    return {
      text: [
        "Keeping your wallet safe:",
        "1. Never share your seed phrase or private key: not with support, Kixo, a bot or a friend. Real teams never ask",
        "2. Only connect your wallet to sites you typed yourself. Fake airdrop and \"claim\" links drain wallets",
        "3. Read what you sign. A request to approve or transfer everything is a trap",
        "4. Keep most funds in a separate wallet you never connect to new sites",
        "5. If a seed phrase was ever exposed, move everything to a new wallet at once",
      ],
      suggestions: ["What is a rug pull?", "Best coins right now"],
    };
  }

  if (has(q, /copy kixo|copy the ai|copy ai|ai copy|auto ?trade|auto ?buy|khud trade|agent/)) {
    return {
      text: [
        "Kixo AI auto trade (Copy Kixo AI) is coming soon. We are training the AI on every new Solana launch, every night, and it launches once it proves it makes money after fees on coins it has never seen",
        "Today you can already use Kixo AI's word on every new coin (Danger, Careful, Calm, Good odds), ask it about any coin, and turn on Rug exit in Settings, Safety",
      ],
      suggestions: ["Is the AI accurate?", "Best coins right now"],
    };
  }

  if (has(q, /accura|track record|been right|is it right|trust|reliab|proof|sahi|how good/)) {
    const tr = o?.track;
    const t = o?.model?.targets;
    const text: string[] = [];
    if (tr && tr.all.coins > 0 && tr.all.dumped != null) {
      text.push(`Live, last 24 hours (${tr.all.coins} coins): ${tr.high_dump.dumped != null ? `coins the AI called high risk dumped ${pct(tr.high_dump.dumped)} of the time` : "no high-risk calls resolved yet"}, vs ${pct(tr.all.dumped)} for all coins${tr.low_dump.dumped != null ? ` and ${pct(tr.low_dump.dumped)} for the ones it called low risk` : ""}`);
    } else {
      text.push("Live results arrive one hour after each score; none have resolved yet");
    }
    if (t) text.push(`On days it never saw in training: its riskiest 10% dumped ${pct(t.dump.top10pct_rate)} of the time vs ${pct(t.dump.base_rate)} on average, and its safest 10% only ${pct(t.dump.bottom10pct_rate)}. Its top 10% for 2x doubled ${pct(t.pump.top10pct_rate)} vs ${pct(t.pump.base_rate)}`);
    text.push("So it is strong at spotting danger. As a buy signal alone it has not made money after fees in testing");
    return { text, suggestions: ["Which coins may rug?", "Best coins right now"] };
  }

  if (has(q, /rug|dump|risk|scam|avoid|danger|worst|khatr|bach|fraud|fake|kharab/)) {
    const list = o?.riskiest ?? [];
    return list.length
      ? { text: ["Coins Kixo AI marks Danger right now. Best to stay away:"], coins: list.slice(0, 5).map((p) => pickCoin(p, ctx.nowSecs)), suggestions: ["Best coins right now", "What is a rug pull?"] }
      : { text: ["No coin with real dump risk scored in the last 30 minutes. Check back in a few minutes"], suggestions: STARTERS };
  }

  if (has(q, /best|2x|double|pump|moon|buy|gem|good|top|pick|acha|achi|khareed|kharid|kaunsa|konsa|kon sa|recommend|profit/)) {
    const list = o?.best ?? [];
    return list.length
      ? {
          text: ["Coins with the best odds right now. Odds, not promises: buy small and set a stop loss:"],
          coins: list.slice(0, 5).map((p) => pickCoin(p, ctx.nowSecs)),
          suggestions: ["Is the AI accurate?", "Copy Kixo AI kya hai?"],
        }
      : { text: ["No low-risk coin with good odds scored in the last 30 minutes. That happens: no trade is a fine trade"], suggestions: STARTERS };
  }

  if (has(q, /how (to|do i)|tips|strategy|beginner|start|kaise|seekh|learn|advice/)) {
    return {
      text: [
        "A simple way to trade new memecoins with Kixo:",
        "1. Start on the demo account until you are profitable for a few weeks",
        "2. Skip coins with high dump risk, a selling dev, high bundles or a dev with earlier rugs",
        "3. Buy small: an amount you can lose. Most new coins go to zero",
        "4. Always set a stop loss and a take profit before you buy",
        "5. Wait for the AI score at 2 minutes instead of buying the first second",
      ],
      suggestions: ["Best coins right now", "What are bundles?", "Copy Kixo AI kya hai?"],
    };
  }

  if (has(q, /^(hi|hey|hello|salam|assalam|aoa|yo)\b/)) {
    return { text: ["Hi. I am Kixo AI. Ask me about any coin (paste its address or $SYMBOL), the best or riskiest coins right now, or any trading word"], suggestions: STARTERS };
  }

  if (termAsked) return { text: [`${termAsked.title}: ${termAsked.text}`], suggestions: STARTERS };

  return {
    text: ["I answer from Kixo's live data. Try one of these, paste a coin address, or write a $SYMBOL from the radar"],
    suggestions: STARTERS,
  };
}
