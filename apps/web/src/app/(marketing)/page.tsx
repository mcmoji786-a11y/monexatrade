import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { LoginPopup, TradeNowButton } from "@/components/account/auth-gate";
import { LivePreview } from "@/components/landing/live-preview";
import { SiteNav } from "@/components/landing/site-nav";
import { MarketingBanner, MarketingPopup } from "@/components/marketing/marketing-ui";
import { seo } from "@/lib/seo";
import {
  ChainData,
  Faq,
  Features,
  Fees,
  FinalCta,
  HowItWorks,
  Security,
  SiteFooter,
} from "@/components/landing/sections";

export async function generateMetadata(): Promise<Metadata> {
  const s = await seo();
  return { title: { absolute: s.title }, description: s.description };
}

export default function LandingPage() {
  return (
    <>
      <MarketingBanner />
      <MarketingPopup />
      <SiteNav />
      <main>
        <section className="mx-auto grid max-w-300 gap-12 px-4 pb-24 pt-16 md:px-8 md:pt-24 lg:grid-cols-[1fr_1.05fr] lg:items-center">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs text-text-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
              Solana mainnet
            </div>
            <h1 className="mt-6 text-4xl font-medium leading-[1.06] tracking-[-0.02em] text-text md:text-6xl md:tracking-[-0.03em]">
              See every new Solana token the second it launches
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-text-2">
              Kixo reads launches straight from the chain, prices them itself and flags the risks it can verify.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <TradeNowButton className={buttonClass("primary", "lg")}>Trade now</TradeNowButton>
              <ButtonLink href="#features" size="lg" variant="ghost">
                See features
              </ButtonLink>
            </div>
          </div>
          <LivePreview />
        </section>

        <Features />
        <HowItWorks />
        <ChainData />
        <Security />
        <Fees />
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
