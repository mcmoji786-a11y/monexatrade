/* Help center articles. Every answer describes how Kixo actually works today; keep
   them in step with the product (fees, limits and decisions in docs/decisions). */

export type Article = { id: string; topic: string; q: string; a: string[] };

export const TOPICS = ["Getting started", "Trading", "Failed trades", "Wallet and safety", "Account and rewards"] as const;

export const ARTICLES: Article[] = [
  {
    id: "what-is-monexa",
    topic: "Getting started",
    q: "What is Kixo?",
    a: [
      "A Solana memecoin terminal: Sol Radar shows new launches the moment they appear on chain, Discover ranks coins, and each coin has a trade page with a live chart, holders, the developer's history and a safety score.",
      "You can practise with a demo account or trade with real SOL from your own Phantom wallet.",
    ],
  },
  {
    id: "demo-vs-real",
    topic: "Getting started",
    q: "What is the difference between Demo and Real?",
    a: [
      "Demo is a virtual $10,000 account. Orders fill at the live market price with real fees and price impact, so results are realistic, but no real money moves.",
      "Real trades use SOL from your own wallet and every one is approved by you in Phantom. Switch with the Demo / Real control at the top.",
    ],
  },
  {
    id: "sign-in",
    topic: "Getting started",
    q: "How do I sign in?",
    a: [
      "With Google, with a code sent to your email, or with Phantom. Signing in never moves funds and Kixo never asks for a seed phrase.",
      "Google and email accounts connect Phantom only when you want to trade; the wallet is not saved.",
    ],
  },
  {
    id: "fees",
    topic: "Trading",
    q: "What does a trade cost?",
    a: [
      "A 1% platform fee: taken from the SOL you spend on a buy, and from the SOL you receive on a sale (charged on the guaranteed minimum, so never more than 1% of what you get).",
      "Then the Solana network costs: the base fee (0.000005 SOL), a priority fee that depends on how busy the network is (capped at 0.001 SOL on Fast and 0.003 SOL on Turbo) and a small tip for the fast sending service. Every amount is shown before you approve.",
    ],
  },
  {
    id: "slippage",
    topic: "Trading",
    q: "What is slippage and what should I set?",
    a: [
      "The price can move between pressing Buy and the trade landing. Slippage is how far you allow it to move; beyond that the trade is refused instead of filling at a worse price.",
      "New memecoins move fast, so 10% is a common default. Set your own default in Settings.",
    ],
  },
  {
    id: "speed",
    topic: "Trading",
    q: "Fast or Turbo?",
    a: [
      "Turbo pays a 0.001 SOL tip and uses every fast path to reach validators. Fast pays far less and uses staked connections only. Turbo lands more reliably when the network is busy.",
    ],
  },
  {
    id: "limits",
    topic: "Trading",
    q: "Is there a limit per trade?",
    a: ["Yes: at most 3 SOL per trade, on the SOL side. Larger amounts can be split into several trades."],
  },
  {
    id: "tp-sl",
    topic: "Trading",
    q: "Do take profit and stop loss work on real trades?",
    a: [
      "Not yet. Every real trade needs your approval in Phantom, and Kixo does not hold your keys, so it cannot sell for you automatically. Take profit and stop loss work in the demo account.",
    ],
  },
  {
    id: "why-failed",
    topic: "Failed trades",
    q: "Why did my trade fail?",
    a: [
      "Paste the transaction signature into the Transaction Doctor above: it reads the transaction on chain and tells you the exact reason. The usual ones are the price moving more than your slippage, not enough SOL for the trade and its fees, or the network not taking it in time.",
    ],
  },
  {
    id: "failed-cost",
    topic: "Failed trades",
    q: "Did a failed trade cost me money?",
    a: [
      "A failed transaction moves no tokens and no trade happens. The network still keeps its small base fee (about 0.000005 SOL plus any priority fee); nobody, including Kixo, can refund it.",
      "A transaction that never landed (expired) costs nothing at all.",
    ],
  },
  {
    id: "retry",
    topic: "Failed trades",
    q: "Is it safe to try again?",
    a: [
      "Kixo checks every trade before you sign it and never sends one twice. If a trade shows as still processing, wait until it settles before trying again, so you do not buy twice.",
    ],
  },
  {
    id: "phantom",
    topic: "Wallet and safety",
    q: "Phantom does not connect",
    a: [
      "Make sure the Phantom extension is installed and unlocked, then press Connect wallet at the top. If Phantom opened on another account, switch to the one you want in Phantom and connect again.",
    ],
  },
  {
    id: "custody",
    topic: "Wallet and safety",
    q: "Does Kixo hold my funds or keys?",
    a: [
      "No. Your SOL stays in your own wallet and every trade is signed by you in Phantom. Kixo builds the transaction, checks it, and shows every cost before you approve.",
      "Nobody from Kixo will ever ask for your seed phrase. If someone does, it is a scam.",
    ],
  },
  {
    id: "safety-score",
    topic: "Wallet and safety",
    q: "What does the safety score mean?",
    a: [
      "A 0 to 100 summary of on-chain warning signs for a coin: how concentrated its holders are, bundled wallets, the developer's earlier coins, and mint and freeze authority. It is a guide, not a guarantee.",
    ],
  },
  {
    id: "referral",
    topic: "Account and rewards",
    q: "How do referrals work?",
    a: ["Share your invite link from Rewards or Settings. People who open a new account from it count as your referrals. Your code is also your name on the competition board."],
  },
  {
    id: "competition",
    topic: "Account and rewards",
    q: "How is the weekly competition ranked?",
    a: [
      "By realised demo profit from Monday to Sunday (UTC). Only sells count, every round counts (a reset never wipes a loss) and you need 3 closed trades to be ranked.",
    ],
  },
  {
    id: "data",
    topic: "Account and rewards",
    q: "Can I download or delete my data?",
    a: ["Yes, in Settings under Data and privacy: download everything Kixo keeps about you as one file, or delete your account."],
  },
];
