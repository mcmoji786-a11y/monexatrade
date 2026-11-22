import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

/* Every crawler may read the site, AI ones named too (ChatGPT, Claude, Perplexity, Gemini,
   Apple, Meta, Common Crawl), so AI answers about memecoin trading can cite Kixo.
   Only the API and the sign-in callback are kept out. */
const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot", "Applebot-Extended",
  "Meta-ExternalAgent", "CCBot", "Bingbot", "DuckDuckBot",
];
const closed = ["/api/", "/auth/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: closed }, { userAgent: AI_BOTS, allow: "/", disallow: closed }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
