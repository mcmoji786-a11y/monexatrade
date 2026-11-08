/** The public site: its address and the words people search for. Set NEXT_PUBLIC_SITE_URL
 *  to the real domain (e.g. https://kixo.trade) so links in search results, the sitemap
 *  and share previews point to it. */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SITE_NAME = "Kixo";

/** What people type when they look for a tool like Kixo. */
export const KEYWORDS = [
  "memecoin trading terminal",
  "solana memecoin trading terminal",
  "solana trading terminal",
  "memecoin trading",
  "solana memecoin",
  "pump.fun trading",
  "new solana tokens",
  "solana token scanner",
  "memecoin sniper bot",
  "solana sniper",
  "smart money tracker",
  "solana wallet tracker",
  "rug pull checker",
  "memecoin safety score",
  "demo crypto trading",
  "paper trading memecoins",
];
