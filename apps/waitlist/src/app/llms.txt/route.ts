import { FAQ, SITE } from "@/lib/seo";
import { AI_FREE, OFFERS } from "@/lib/offers";
import { SOCIALS } from "@/lib/socials";

/* `/llms.txt` (llmstxt.org): a plain summary of Kixo for AI assistants and their search
   tools, built from the same FAQ and offers the page shows, so it never says more than
   the site does. */
export const dynamic = "force-static";

export function GET() {
  const lines = [
    "# Kixo",
    "",
    "> Kixo is a Solana memecoin trading terminal with an AI agent at its core. It shows every new memecoin the moment it launches, gives each coin a rug-pull safety score from on-chain checks, labels dev, sniper, bundler and whale wallets, and lets an AI agent auto-trade within limits the user sets. Kixo is launching soon; the waitlist is open at " + SITE + ".",
    "",
    "Kixo is not financial advice. Memecoins are high risk.",
    "",
    "## Links",
    "",
    `- [Kixo waitlist](${SITE}/): join for early access and launch offers`,
    ...SOCIALS.map((s) => `- [Kixo on ${s.name}](${s.href})`),
    "",
    "## Waitlist offers",
    "",
    ...OFFERS.map((o) => `- ${o.how}: ${o.off}% off Kixo's trading fee for ${o.months} months${o.extra ? `, plus ${o.extra}` : ""}`),
    `- Everyone on the waitlist: ${AI_FREE.title}`,
    "",
    "## Questions and answers",
    "",
    ...FAQ.flatMap((f) => [`### ${f.q}`, "", f.a, ""]),
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
