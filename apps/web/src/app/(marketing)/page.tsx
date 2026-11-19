import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { LoginPopup, TradeNowButton } from "@/components/account/auth-gate";
import { SiteNav } from "@/components/landing/site-nav";
import { MarketingBanner, MarketingPopup } from "@/components/marketing/marketing-ui";
import { DEFAULT_DESCRIPTION, seo } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { JsonLd } from "@/components/seo/json-ld";
import {
  FAQ,
  Faq,
  Features,
  FinalCta,
  WhyKixo,
  SiteFooter,
} from "@/components/landing/sections";
import { ProductTour } from "@/components/landing/product-tour";
import { RugStory } from "@/components/landing/rug-story";
import { AiRecord } from "@/components/landing/ai-record";
import { AiTicker, JustCalled } from "@/components/landing/ai-pulse";
import { TrenchesWall } from "@/components/landing/trenches-wall";
import { AutoTradeSoon, NumbersBand } from "@/components/landing/landing-extras";

export async function generateMetadata(): Promise<Metadata> {
  const s = await seo();
  return { title: { absolute: s.title }, description: s.description, alternates: { canonical: "/" } };
}

const STRUCTURED = [
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Kixo",
    url: SITE_URL,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web browser",
    description: DEFAULT_DESCRIPTION,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free to use; 0.5% fee per trade" },
    featureList: [
      "Real-time new Solana token launches",
      "Memecoin safety score",
      "Sniper bot",
      "Smart money and wallet tracking",
      "Live on-chain news",
      "Demo trading account at live prices",
    ],
  },
  { "@context": "https://schema.org", "@type": "Organization", name: "Kixo", url: SITE_URL, logo: `${SITE_URL}/brand/kixo-mark.png` },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  },
];

export default function LandingPage() {
  return (
    <>
      <JsonLd data={STRUCTURED} />
      <MarketingBanner />
      <MarketingPopup />
      <SiteNav />
      <main>
        <section className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-300 items-center gap-12 px-4 py-16 md:px-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="flex items-center gap-2 font-mono text-xs text-text-2">
              <span className="size-1.5 rounded-full bg-emerald" />
              Solana memecoin trading terminal
            </p>
            <h1 className="mt-6 text-5xl font-medium leading-[1.04] tracking-[-0.02em] text-text md:text-6xl md:tracking-[-0.03em]">
              <span className="block lg:whitespace-nowrap">Catch the launch.</span>
              <span className="block text-text-2">Skip the rug</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-text-2">
              Kixo sees every new Solana coin the second it launches, reads its first 2 minutes with its own AI and tells you Danger or Good odds before you buy.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <TradeNowButton className={buttonClass("primary", "lg")}>Start with $10,000 demo</TradeNowButton>
              <ButtonLink href="#product" size="lg" variant="ghost">
                See it work
              </ButtonLink>
            </div>
          </div>
          <div className="relative h-96 sm:h-[560px] lg:h-[640px]">
            <TrenchesWall />
            <div className="absolute bottom-6 -left-6 hidden xl:block">
              <JustCalled />
            </div>
          </div>
        </section>

        <AiTicker />
        <NumbersBand />
        <ProductTour />
        <RugStory />
        <AiRecord />
        <AutoTradeSoon />
        <Features />
        <WhyKixo />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <Suspense fallback={null}>
        <LoginPopup />
      </Suspense>
    </>
  );
}
