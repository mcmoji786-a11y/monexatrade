/** Kixo Learn: plain guides to Solana memecoin trading, for traders and for search. Each
 *  one is factual and general; none promises returns. Rendered by app/(marketing)/learn. */

export type Block = { p: string } | { list: string[] } | { steps: string[] } | { note: string };
export type Guide = {
  slug: string;
  title: string;
  /** Search result text: under ~160 characters. */
  description: string;
  updated: string;
  minutes: number;
  sections: { h: string; body: Block[] }[];
  /** Where in Kixo to try what the guide explains. */
  cta: { label: string; href: string };
  related: string[];
};

export const GUIDES: Guide[] = [
  {
    slug: "what-is-a-memecoin-trading-terminal",
    title: "What is a memecoin trading terminal?",
    description: "A memecoin trading terminal puts new launches, charts, safety checks and one-click trading on one screen. What it does, what to look for and how Kixo works.",
    updated: "2026-11-08",
    minutes: 5,
    sections: [
      {
        h: "The short answer",
        body: [
          { p: "A memecoin trading terminal is a trading screen built for fast, new tokens. It shows coins the moment they launch, prices them from on-chain trades, checks who holds them and lets you buy or sell in one or two clicks, without hopping between a block explorer, a chart site and a wallet." },
          { p: "On Solana, thousands of tokens launch every day on launchpads such as pump.fun, letsbonk.fun, Bags and Moonshot. A terminal turns that stream into something you can read and act on in seconds." },
        ],
      },
      {
        h: "What a good terminal does",
        body: [
          {
            list: [
              "New launches in real time, read from the chain rather than from a slow listing site",
              "Price, market cap, volume, holders and bonding-curve progress for every coin",
              "Safety checks you can verify: mint and freeze authority, top-holder share, dev holdings, bundled and sniper wallets",
              "Fast trading with clear fees, slippage and price impact shown before you confirm",
              "Exits that run for you: take profit, stop loss and trailing stops",
              "Wallet tools: follow profitable traders, see what any wallet holds and trades",
            ],
          },
        ],
      },
      {
        h: "Terminal, Telegram bot or DEX?",
        body: [
          { p: "A decentralized exchange (DEX) is where the trade happens. A Telegram bot lets you trade by typing commands, which is quick but shows little information. A terminal shows the whole picture (chart, holders, trades, risks) next to the buy button, which is why most active memecoin traders use one." },
        ],
      },
      {
        h: "What to check before you pick one",
        body: [
          {
            list: [
              "Who holds the key to your trading wallet. Prefer tools where only you can sign",
              "The full cost of a trade: platform fee, network fee and price impact, all shown up front",
              "Whether you can practise first without real money",
              "Whether the safety data is explained, not just a green or red badge",
            ],
          },
        ],
      },
      {
        h: "How Kixo approaches it",
        body: [
          { p: "Kixo reads launches straight from Solana, prices pump.fun coins with its own decoder and scores each coin on checks it can verify. Your trading wallet's key is locked in your own browser with your password, and Kixo stores only the locked copy. A free demo account trades at live prices with real fees and price impact, so you can learn the terminal before using real SOL." },
          { note: "Most new memecoins lose most of their value. Never trade more than you can afford to lose." },
        ],
      },
    ],
    cta: { label: "Open Sol Radar", href: "/radar" },
    related: ["how-to-trade-solana-memecoins", "how-to-spot-a-rug-pull", "what-is-a-solana-sniper-bot"],
  },
  {
    slug: "how-to-trade-solana-memecoins",
    title: "How to trade Solana memecoins: a step-by-step guide",
    description: "Set up a wallet, find new Solana memecoins, check them for red flags, size your trade and plan your exit. A practical guide for beginners.",
    updated: "2026-11-08",
    minutes: 7,
    sections: [
      {
        h: "1. Get SOL into a trading wallet",
        body: [
          { p: "Every Solana trade is paid in SOL. Buy SOL on an exchange, send it to your wallet (Phantom is common), then move what you want to trade into your terminal's trading wallet. Keep the rest elsewhere: a trading wallet should only hold what you are ready to trade." },
        ],
      },
      {
        h: "2. Practise before you use real money",
        body: [
          { p: "Memecoins move in seconds and the costs are easy to underestimate. A demo account that uses live prices, real fees and price impact shows you what a round trip really costs. On a small coin, buying and selling straight away can lose a few percent even if the price did not move." },
        ],
      },
      {
        h: "3. Find coins",
        body: [
          {
            list: [
              "New launches: coins minutes old, still on their bonding curve. Highest risk, fastest moves",
              "Graduated coins: coins whose curve filled and that now trade in a DEX pool",
              "Trending coins: where volume suddenly rises compared with the last hour",
              "Smart money: coins that wallets with a strong record are buying",
            ],
          },
        ],
      },
      {
        h: "4. Check it before you buy",
        body: [
          {
            steps: [
              "Mint authority revoked, so nobody can print more tokens",
              "Freeze authority revoked, so nobody can freeze your tokens",
              "Top 10 holders own a reasonable share (a few wallets holding most of the supply can dump on you)",
              "The developer's own holding, and whether the developer has sold",
              "Bundled and sniper wallets: many wallets that bought in the first seconds often sell together",
              "The developer's history: have their earlier coins been abandoned or rugged?",
            ],
          },
        ],
      },
      {
        h: "5. Size the trade and set slippage",
        body: [
          { p: "Decide the most you are willing to lose on this one coin, and buy no more than that. Slippage is how far the price may move between clicking and filling; set it too low and trades fail, too high and you can fill at a bad price. Watch the price impact shown before you confirm: on a thin coin a large buy moves the price against you." },
        ],
      },
      {
        h: "6. Plan the exit before the entry",
        body: [
          { p: "Set a take profit and a stop loss as soon as you buy. A trailing stop follows the price up and sells if it falls back by the amount you choose, which keeps part of a run without watching the screen. Many traders sell part at a first target and let the rest ride." },
          { note: "Nothing here is financial advice. Most memecoins go to zero." },
        ],
      },
    ],
    cta: { label: "Try the free demo account", href: "/discover" },
    related: ["how-to-spot-a-rug-pull", "pump-fun-bonding-curve-explained", "what-is-a-memecoin-trading-terminal"],
  },
  {
    slug: "how-to-spot-a-rug-pull",
    title: "How to spot a rug pull on Solana",
    description: "The on-chain red flags behind most Solana memecoin rug pulls: authorities, holder concentration, dev wallets, bundles, snipers and dev history.",
    updated: "2026-11-08",
    minutes: 6,
    sections: [
      {
        h: "What a rug pull is",
        body: [
          { p: "A rug pull is when the people behind a coin take the money buyers put in and leave: they sell a large hidden supply, pull the liquidity, or use a power they kept over the token. Most of these leave traces on chain before they happen." },
        ],
      },
      {
        h: "Red flags you can check yourself",
        body: [
          {
            list: [
              "Mint authority still on: the creator can print new tokens and sell them",
              "Freeze authority still on: your tokens can be frozen so you cannot sell",
              "Top holders own too much: if ten wallets hold half the supply, they decide the price",
              "Dev holds a big share, or has already sold everything",
              "Bundled buys: several wallets bought in the same block as the launch, often funded by the same source",
              "Many snipers that bought in the first seconds and still hold a large share",
              "A developer whose earlier coins were abandoned or dumped",
              "Copycat names: a new coin using the ticker or X account of a coin that is already popular",
            ],
          },
        ],
      },
      {
        h: "Signs that lower (not remove) the risk",
        body: [
          {
            list: [
              "Both authorities revoked",
              "Holders spread out and growing, with top 10 under about a third of the supply",
              "Real trading from many distinct wallets rather than a few bots",
              "The coin graduated from its bonding curve to a DEX pool",
            ],
          },
          { note: "No check makes a memecoin safe. A clean coin can still go to zero if buyers stop coming." },
        ],
      },
      {
        h: "How Kixo shows this",
        body: [
          { p: "Every coin in Kixo gets a safety score built from these checks, with each one listed so you can see why. Sol Radar's Lower risk tab only shows coins that pass the strictest rules for a few minutes, and Kixo's news feed warns when a developer sells out." },
        ],
      },
    ],
    cta: { label: "See safety scores on Sol Radar", href: "/radar" },
    related: ["how-to-trade-solana-memecoins", "what-is-a-solana-sniper-bot", "how-to-track-smart-money-wallets"],
  },
  {
    slug: "what-is-a-solana-sniper-bot",
    title: "What is a Solana sniper bot and how does it work?",
    description: "A sniper bot buys new Solana tokens the moment they meet your rules and sells on your targets. How it works, the settings that matter and the risks.",
    updated: "2026-11-08",
    minutes: 5,
    sections: [
      {
        h: "What it does",
        body: [
          { p: "A sniper bot watches new token launches and buys automatically when a coin meets rules you set, such as a minimum number of holders, a low developer share and a passing safety score. It then sells on your take profit, stop loss, trailing stop or time limit." },
        ],
      },
      {
        h: "The settings that matter",
        body: [
          {
            list: [
              "Buy size: the SOL spent on each snipe",
              "Maximum coin age: how new a coin must be",
              "Holder, trade and safety minimums: filters that skip the worst launches",
              "Developer, top-10, bundle and early-buyer limits",
              "Take profit, stop loss, trailing stop and maximum hold time",
              "Limits per hour, open positions and a daily cap on real SOL",
            ],
          },
        ],
      },
      {
        h: "The risks",
        body: [
          { p: "Speed cuts both ways. A bot that buys in the first seconds also buys the coins that are rugged in the next minute. Fees and price impact add up across many small trades, and a strategy that looks good on paper can lose once real costs are counted. Test settings in a demo account first and keep sizes small." },
        ],
      },
      {
        h: "Sniping on Kixo",
        body: [
          { p: "Kixo's sniper runs in your browser while Kixo is open. In demo mode every buy and sell is a demo order filled at live prices, so its results are what the trades really made. Real SOL needs three switches turned on and has a daily cap." },
        ],
      },
    ],
    cta: { label: "Open the Sniper", href: "/sniper" },
    related: ["how-to-spot-a-rug-pull", "how-to-trade-solana-memecoins", "pump-fun-bonding-curve-explained"],
  },
  {
    slug: "how-to-track-smart-money-wallets",
    title: "How to track smart money wallets on Solana",
    description: "Find Solana wallets with a real trading record, follow what they buy and sell, and avoid the traps of copying traders blindly.",
    updated: "2026-11-08",
    minutes: 5,
    sections: [
      {
        h: "What smart money means",
        body: [
          { p: "Smart money is shorthand for wallets that have made money trading over many coins, not one lucky trade. Because every Solana trade is public, you can see what these wallets buy, how long they hold and when they sell." },
        ],
      },
      {
        h: "How to judge a wallet",
        body: [
          {
            list: [
              "Realized profit over weeks, not one big win",
              "Win rate together with the size of wins and losses",
              "How long it holds: seconds-long flips are hard to follow in time",
              "Whether it buys coins it created or was paid to promote",
              "Whether it sells right after others pile in behind it",
            ],
          },
        ],
      },
      {
        h: "Following without getting burned",
        body: [
          { p: "By the time you see a wallet's buy, the price has already moved. Copy only part of a position, set your own exits, and watch the gap between the wallet's price and yours: if it is large every time, following that wallet costs more than it makes." },
        ],
      },
      {
        h: "Wallet tools on Kixo",
        body: [
          { p: "Kixo's Smart Money page ranks wallets by realized results. Click any wallet address anywhere in Kixo to open the Wallet Tracker: its balance, every coin it holds and its recent swaps. Add it to Wallet Monitor for an alert when it trades." },
        ],
      },
    ],
    cta: { label: "Open Smart Money", href: "/smart-money" },
    related: ["what-is-a-solana-sniper-bot", "how-to-trade-solana-memecoins", "how-to-spot-a-rug-pull"],
  },
  {
    slug: "pump-fun-bonding-curve-explained",
    title: "Pump.fun bonding curves and graduation, explained",
    description: "How a pump.fun bonding curve prices a new coin, what curve progress means, and what happens when a coin graduates to a DEX pool.",
    updated: "2026-11-08",
    minutes: 4,
    sections: [
      {
        h: "The bonding curve",
        body: [
          { p: "A coin launched on pump.fun (and similar launchpads) starts on a bonding curve: a program that sells tokens at a price set by a formula. Each buy takes tokens from the curve and pushes the price up; each sell returns tokens and pushes it down. There is no order book and no one has to add liquidity." },
        ],
      },
      {
        h: "Curve progress",
        body: [
          { p: "Curve progress is the share of the curve's sellable tokens already bought. A coin at 80% is close to filling its curve. Progress can also fall when holders sell." },
        ],
      },
      {
        h: "Graduation",
        body: [
          { p: "When the curve sells out, the coin graduates: its liquidity moves to a regular DEX pool (PumpSwap for pump.fun coins) and trading continues there. Graduation is often a busy moment, with new buyers arriving and early holders taking profit." },
          { note: "Graduating is a milestone, not a guarantee. Many coins fall after it." },
        ],
      },
      {
        h: "Seeing it on Kixo",
        body: [
          { p: "Sol Radar shows curve progress for every new coin, and Kixo's news feed posts when a coin with a real crowd of holders graduates." },
        ],
      },
    ],
    cta: { label: "Watch curves on Sol Radar", href: "/radar" },
    related: ["how-to-trade-solana-memecoins", "what-is-a-memecoin-trading-terminal", "how-to-spot-a-rug-pull"],
  },
];

export const guide = (slug: string) => GUIDES.find((g) => g.slug === slug);
