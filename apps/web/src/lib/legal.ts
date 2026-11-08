/* The Terms of Use and Privacy Policy in plain words. Every line describes how Kixo
   actually works today. Changing the meaning of either one: raise TERMS_VERSION in
   lib/account.ts so every user accepts the new text. */

export const LEGAL_UPDATED = "2026-11-09";

export type LegalSection = { title: string; body: string[] };

export const TERMS: LegalSection[] = [
  {
    title: "What Kixo is",
    body: [
      "Kixo is a trading terminal for Solana memecoins. It shows on-chain data about coins and wallets, and gives you tools to trade them: a demo account with virtual money, and a Kixo trading wallet for real trades when real trading is open.",
      "Kixo is software, not a broker, exchange, bank or adviser. We do not hold your coins and we do not trade for you on our own.",
    ],
  },
  {
    title: "Not financial advice",
    body: [
      "Safety scores, labels (dev, sniper, bundler, whale, smart money), news, rankings, backtests, AI notes and every other figure in Kixo are information, not advice and not a recommendation to buy or sell.",
      "Memecoins are extremely risky. Most lose most or all of their value, often within minutes. A good safety score means fewer red flags were found, never that a coin is safe. Only trade what you can afford to lose.",
    ],
  },
  {
    title: "Who can use Kixo",
    body: ["You must be 18 or older, and using Kixo and trading crypto must be legal where you live. You are responsible for any taxes on your trades."],
  },
  {
    title: "Your Kixo wallet and your keys",
    body: [
      "Your Kixo trading wallet is created in your own browser and locked with your password before anything leaves your device. Kixo stores only that locked copy, so you can open it on another device. We cannot see your private key, and we cannot unlock the wallet or reset its password for you. Keep your password safe.",
      "We will never ask for your seed phrase or private key. Anyone who does is not Kixo.",
      "A trade or transfer you sign is sent to the Solana network and cannot be undone by us. Prices can move between the quote and the moment your transaction lands; your slippage setting limits how far.",
    ],
  },
  {
    title: "Fees",
    body: ["Kixo charges a fee on each real trade (0.5% today) and may charge a fee on withdrawals. The fee is shown before you confirm. Solana network and priority fees are paid to the network, not to Kixo. Deposits are free."],
  },
  {
    title: "The demo account",
    body: [
      "The demo account trades virtual money at live market prices, with the same fees and price impact real trading would have. Demo results, rankings and share cards are not real profits and are always labelled as demo.",
      "The weekly competition ranks demo results only. It has no cash prize unless Kixo announces one with its own rules.",
    ],
  },
  {
    title: "Automatic tools",
    body: [
      "Orders (limit, stop loss, trailing stop), grids, copy trading and the sniper run in your browser while Kixo is open there. If the tab is closed, asleep or offline, they do not run. Orders can fill at a worse price than set when the market jumps, or not fill at all.",
      "Copy trading follows public wallets that can stop trading, change style or sell into their followers. Past results, including backtests, do not predict future results. You choose and control every rule.",
    ],
  },
  {
    title: "Data from the chain and other services",
    body: ["Kixo reads public blockchain data and data from other services (price, pool and token information). It can be late, incomplete or wrong. Check anything important yourself before you trade."],
  },
  {
    title: "Fair use",
    body: [
      "Do not attack, overload or scrape Kixo, try to reach other users' data, or misuse the referral program or the competition (for example with several accounts). Do not use Kixo to break the law or to manipulate markets.",
      "We may limit or close accounts that do, and remove results gained that way.",
    ],
  },
  {
    title: "Changes and availability",
    body: [
      "Kixo is provided as it is. We work to keep it running but cannot promise it will always be available or free of errors. We may add, change or remove features.",
      "When these terms change in a way that matters, we will ask you to accept them again before you continue.",
    ],
  },
  {
    title: "Limits of our responsibility",
    body: ["As far as the law allows, Kixo is not responsible for trading losses, for losses caused by the network, other services or a lost password, or for decisions you make with information shown in Kixo."],
  },
  {
    title: "Contact",
    body: ["Questions about these terms: open Support in the app and write to us."],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    title: "What we keep",
    body: [
      "Your account: your email address or Google account email, or the wallet address you signed in with, how you signed in, and when you accepted these terms.",
      "Your Kixo wallet: its public address and the locked copy of its key (locked with your password in your browser; we cannot open it), and whether new-device codes are on.",
      "Your activity in Kixo: your settings, your demo account, demo trades and demo orders, records of your real trades, your referral code and who joined with it, and your support conversations.",
      "Public wallet history: when you open a wallet in the Wallet Tracker, we store that wallet's public swaps so the next visit is faster. This is public blockchain data.",
      "To run and protect the service, our servers see your IP address and basic technical data with each request, and which page an open tab is showing (for live counts). We do not use advertising trackers.",
    ],
  },
  {
    title: "What stays in your browser",
    body: ["Some things never reach our servers: your watchlist, Wallet Monitor list, real orders, grids and copies, notification choices, streamer mode and similar preferences are stored in your browser only. Clearing your browser data removes them."],
  },
  {
    title: "What we never collect",
    body: ["Your seed phrase or unlocked private key. Your password for the Kixo wallet. We never sell your data."],
  },
  {
    title: "Why we use it",
    body: ["To sign you in, run your demo and real trades, show your history, answer support, credit referrals, prevent abuse, and fix and improve Kixo."],
  },
  {
    title: "Who else handles it",
    body: [
      "Kixo runs on service providers that process data for us: our database and sign-in provider, our hosting, and Solana RPC and market-data providers (which see the wallet and coin addresses we ask about, as everyone on the public chain can). Google or your wallet app take part when you sign in with them.",
      "Real trades are public on the Solana blockchain by nature, and anyone can see a wallet's activity there.",
    ],
  },
  {
    title: "Your choices",
    body: ["In Settings you can download everything Kixo keeps about you as one file, and delete your account. Deleting removes your account data from Kixo; it cannot remove anything already on the public blockchain."],
  },
  {
    title: "How long we keep it",
    body: ["Account data is kept while your account exists. Public wallet history is kept up to 30 days. Server logs are kept for a short time for security."],
  },
  {
    title: "Changes and contact",
    body: ["If this policy changes in a way that matters, we will tell you in the app. Questions: open Support in the app and write to us."],
  },
];
