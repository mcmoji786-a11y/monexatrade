import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/sections";

export const metadata: Metadata = {
  title: "Kixo AI API",
  description: "Kixo AI for developers: the chance a new Solana coin crashes or doubles within the hour, recent scores and KOL buys, over a simple REST API with your own key.",
  alternates: { canonical: "/developers" },
};

// The live API address once Kixo is hosted (NEXT_PUBLIC_GATEWAY_URL); the local one until then.
const BASE = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";

const ENDPOINTS: { method: string; path: string; what: string; example: string }[] = [
  {
    method: "GET",
    path: "/v1/ai/risk?mints=<a,b,...>",
    what: "Kixo AI's read on up to 50 coins: the chance each falls 70% or more within the hour (dump_chance), the chance it doubles (double_chance), and the one-word verdict. A coin is scored 2 minutes after its first trade; before that it is null.",
    example: `{
  "risk": {
    "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": {
      "dump_chance": 0.118, "double_chance": 0.204,
      "verdict": "good_odds", "trades_seen": 86, "scored_at": 1794772800
    }
  }
}`,
  },
  {
    method: "GET",
    path: "/v1/ai/recent?minutes=10",
    what: "Every coin scored in the last 1 to 60 minutes, newest first, with the same fields and its mint.",
    example: `{ "minutes": 10, "coins": [ { "mint": "…", "dump_chance": 0.41, "double_chance": 0.03, "verdict": "danger", … } ] }`,
  },
  {
    method: "GET",
    path: "/v1/kols/coins",
    what: "Coins that well-known traders (KOLs) bought in the last 24 hours, with their names and X handles.",
    example: `{ "coins": { "<mint>": [ { "name": "…", "x": "…" } ] } }`,
  },
  {
    method: "GET",
    path: "/v1/usage",
    what: "Your key's calls today and its limits.",
    example: `{ "calls_today": 128, "per_day": 10000, "per_minute": 60 }`,
  },
];

export default function DevelopersPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-200 px-4 pt-16 pb-24 md:px-8 md:pt-20">
        <p className="font-mono text-xs text-emerald">Developers</p>
        <h1 className="mt-3 text-4xl font-medium leading-tight text-text md:text-5xl">Kixo AI API</h1>
        <p className="mt-4 text-base leading-7 text-text-2">
          The model behind Kixo&apos;s Danger, Careful, Calm and Good odds words, for your own bot, dashboard or Telegram group. Trained on thousands of Solana launches; it reads a coin&apos;s first two minutes of trades and gives the chance it crashes or doubles within the hour.
        </p>

        <section className="mt-12 border-t border-border pt-8">
          <h2 className="text-lg text-text">Get a key</h2>
          <p className="mt-3 text-sm leading-7 text-text-2">
            Sign in, open <Link href="/settings#developer" className="text-text underline underline-offset-2">Settings, Developer API</Link> and make a key. It is shown once; Kixo keeps only a hash of it. Send it with every call:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-6 text-text-2">{`curl -H "x-api-key: kixo_…" "${BASE}/v1/ai/risk?mints=<mint>"`}</pre>
          <p className="mt-3 text-sm leading-7 text-text-2">Limits: 60 calls a minute and 10,000 a day per key, up to 5 keys per account. Too many calls answer 429; the daily count resets at 00:00 UTC.</p>
        </section>

        <section className="mt-10 border-t border-border pt-8">
          <h2 className="text-lg text-text">Endpoints</h2>
          <ol className="mt-4 divide-y divide-border border-y border-border">
            {ENDPOINTS.map((e) => (
              <li key={e.path} className="py-6">
                <p className="font-mono text-sm text-text">
                  <span className="mr-2 text-emerald">{e.method}</span>
                  {e.path}
                </p>
                <p className="mt-2 text-sm leading-7 text-text-2">{e.what}</p>
                <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-6 text-text-2">{e.example}</pre>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 border-t border-border pt-8">
          <h2 className="text-lg text-text">Read it right</h2>
          <p className="mt-3 text-sm leading-7 text-text-2">
            These are chances from a model, not promises: most new coins lose their value, and a Calm or Good odds coin can still crash. Kixo shows the model&apos;s track record on the Kixo AI page. Nothing here is financial advice.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
