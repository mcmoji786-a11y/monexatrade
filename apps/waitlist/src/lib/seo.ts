/* Search content for the waitlist: the FAQ (shown on the page and as FAQPage data) and
   the site facts. Answers describe Kixo honestly as it will launch. */

export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";

export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Kixo?",
    a: "Kixo is a Solana memecoin trading terminal with an AI agent at its core. It shows every new memecoin the second it launches, checks each coin for rug-pull risk, and lets an AI agent trade for you within the limits you set.",
  },
  {
    q: "What is an AI trading bot for Solana memecoins?",
    a: "A program that watches new tokens and wallets on Solana and places trades automatically. Kixo's AI agent picks from 100,000+ strategies backtested on market data, and only trades within your rules: how much per trade, a daily loss limit and a minimum safety score.",
  },
  {
    q: "How does Kixo spot a rug pull before you buy?",
    a: "Every coin gets a safety score from on-chain checks: mint and freeze authority, how much the top holders and the dev own, bundled wallets that bought in the same block at launch, snipers, and how the dev's earlier coins ended. Wallets are labelled dev, sniper, bundler, whale or smart money where you trade.",
  },
  {
    q: "Which launchpads does Kixo cover?",
    a: "pump.fun, letsbonk.fun, Bags, Moonshot, Meteora and Raydium LaunchLab, plus graduated coins trading on PumpSwap and other Solana DEX pools.",
  },
  {
    q: "Does the AI agent trade 24/7?",
    a: "Yes. It runs on Kixo's servers from a separate auto-trade wallet you fund with only what you want traded automatically. Money in that wallet can only go back to your own Kixo wallet, and one switch pauses everything.",
  },
  {
    q: "Is my wallet safe with Kixo?",
    a: "Your main Kixo wallet is created and locked in your own browser; Kixo never sees its key and never asks for a seed phrase. The auto-trade wallet's key is sealed and encrypted on the server and can only send money back to you.",
  },
  {
    q: "Can I practise without risking money?",
    a: "Yes. Kixo includes a free demo account with $10,000 of virtual money at live market prices, with the same fees and price impact as real trades.",
  },
  {
    q: "What do I get for joining the waitlist?",
    a: "Early access, the Kixo AI agent free for one year, and a discount on Kixo's trading fee: 25% for everyone, up to 50% when friends join with your invite link.",
  },
  {
    q: "When does Kixo launch?",
    a: "Kixo opens when the AI agent is ready. The waitlist gets in first and hears about it by email.",
  },
];

export function jsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Kixo",
      url: SITE,
      logo: `${SITE}/kixo-mark.png`,
      description: "AI trading agent and Solana memecoin trading terminal.",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Kixo",
      url: SITE,
      description: "The AI that trades Solana memecoins for you. Join the waitlist.",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Kixo",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      url: SITE,
      description: "Solana memecoin trading terminal with an AI agent that auto-trades within your limits, a safety score on every coin and wallet labels for devs, snipers and bundlers.",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
}
