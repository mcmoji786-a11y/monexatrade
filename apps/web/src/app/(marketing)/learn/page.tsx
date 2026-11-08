import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/sections";
import { JsonLd } from "@/components/seo/json-ld";
import { GUIDES } from "@/lib/guides";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Learn Solana memecoin trading",
  description: "Plain guides to Solana memecoin trading: what a trading terminal does, how to trade new tokens, spot rug pulls, use a sniper bot and track smart money.",
  alternates: { canonical: "/learn" },
  openGraph: { title: "Learn Solana memecoin trading · Kixo", url: "/learn" },
};

export default function LearnPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Learn Solana memecoin trading",
          url: `${SITE_URL}/learn`,
          hasPart: GUIDES.map((g) => ({ "@type": "Article", headline: g.title, url: `${SITE_URL}/learn/${g.slug}` })),
        }}
      />
      <SiteNav />
      <main className="mx-auto max-w-300 px-4 pt-16 pb-24 md:px-8 md:pt-20">
        <p className="font-mono text-xs text-emerald">Learn</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-medium leading-tight text-text md:text-5xl">Solana memecoin trading, explained plainly</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-text-2">How new tokens launch, what to check before you buy, and how traders use terminals, snipers and wallet tracking. No hype and no promises</p>

        <ol className="mt-12 divide-y divide-border border-y border-border">
          {GUIDES.map((g, i) => (
            <li key={g.slug}>
              <Link href={`/learn/${g.slug}`} className="group grid gap-2 py-6 transition-colors md:grid-cols-[48px_1fr_auto] md:items-baseline md:gap-6">
                <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block text-lg text-text group-hover:underline group-hover:underline-offset-4">{g.title}</span>
                  <span className="mt-1 block max-w-2xl text-sm leading-6 text-text-2">{g.description}</span>
                </span>
                <span className="flex items-center gap-2 font-mono text-xs text-muted">
                  {g.minutes} min read
                  <ArrowRight size={14} strokeWidth={1.5} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </main>
      <SiteFooter />
    </>
  );
}
