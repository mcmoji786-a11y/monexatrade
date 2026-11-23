import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/sections";
import { CreatorApply, CreatorShare, EarningsExample } from "@/components/creators/creator-program";
import { CREATOR, FALLBACK_CONFIG } from "@/lib/rewards";
import { SITE_URL } from "@/lib/site";

const SHARE = FALLBACK_CONFIG.creator_max_share_pct;
const TITLE = "Kixo Creator & Rewards Program";
const DESCRIPTION = `Earn up to ${SHARE}% of the trading fees from the traders you bring to Kixo, the Solana memecoin terminal. Your own invite code, a creator page, live stats and early features. Apply in two minutes.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["Kixo creator program", "Kixo rewards program", "Kixo trade rewards", "Kixo referral", "memecoin affiliate program", "Solana trading referral", "crypto creator program"],
  alternates: { canonical: "/creators" },
  openGraph: { title: `${TITLE} · Kixo`, description: DESCRIPTION, url: "/creators", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const STEPS = [
  { title: "Apply", body: "Tell us where you post. Any platform, no minimum follower count" },
  { title: "Get approved", body: "The Kixo team checks your profiles and replies within two days" },
  { title: "Share and earn", body: "Your own code and page. You earn from every trade your audience makes, for as long as they trade" },
];

const FAQ: { q: string; a: string }[] = [
  { q: "What is the Kixo Creator Program?", a: `A rewards program for people who bring traders to Kixo. Creators get their own invite code and earn up to ${SHARE}% of the trading fees their audience pays on Kixo, above the public referral tiers.` },
  { q: "Who can join?", a: "Anyone with an audience of traders: X, Telegram, YouTube, TikTok, Twitch or Discord. There is no minimum follower count; we look at the quality of your content and audience." },
  { q: "How much can I earn?", a: `Your share is up to ${SHARE}% of the fees your audience pays. Kixo charges a small fee on each trade, so the more your audience trades, the more you earn. There is no cap and no end date.` },
  { q: "When and how am I paid?", a: "Earnings are added to your rewards balance after each trade your audience makes and are claimable in SOL to your wallet. Payouts start when real trading opens on Kixo." },
  { q: "Is there a cost to join?", a: "No. Joining is free and you can leave at any time." },
  { q: "What is not allowed?", a: "Paid pumps, fake calls, hidden promotions and misleading claims. Creators disclose that they earn from Kixo invites. Breaking these rules ends the partnership." },
  { q: "Is this different from the referral program?", a: "Yes. Every Kixo user can invite friends through the referral program in Rewards. The Creator Program is for people with an audience and pays a higher share, plus a creator page, live stats and early features." },
];

/** kixo.trade/creators: the Creator Program, open to everyone without an account, with
 *  the application form. The share comes live from the admin's rewards settings. */
export default function CreatorsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${SITE_URL}/creators`, url: `${SITE_URL}/creators`, name: TITLE, description: DESCRIPTION, isPartOf: { "@id": `${SITE_URL}/#website` } },
      { "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };
  return (
    <>
      <SiteNav />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="mx-auto max-w-300 px-4 pb-24 md:px-8">
        {/* Hero: what the program pays, next to the form */}
        <section className="grid gap-10 pt-16 md:pt-20 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-start">
          <div className="lg:pt-6">
            <p className="font-mono text-xs text-emerald">Kixo Creator Program</p>
            <h1 className="mt-3 text-4xl font-medium leading-tight text-text md:text-5xl">
              Bring traders to Kixo.
              <br />
              Earn <span className="text-emerald"><CreatorShare /></span> of their fees
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-text-2">
              You post about Solana memecoins and people listen. Give them a faster terminal with rug checks and Kixo AI, and earn from every trade they make, for as long as they trade
            </p>
            <dl className="mt-10 grid max-w-xl grid-cols-3 gap-6 border-t border-border pt-6">
              <div>
                <dt className="text-xs text-muted">Your share</dt>
                <dd className="mt-1 font-mono text-lg text-text sm:text-2xl">
                  up to <CreatorShare />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Paid in</dt>
                <dd className="mt-1 font-mono text-lg text-text sm:text-2xl">SOL</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Earnings end</dt>
                <dd className="mt-1 font-mono text-lg text-text sm:text-2xl">Never</dd>
              </div>
            </dl>
          </div>
          <div id="apply" className="scroll-mt-24">
            <CreatorApply />
          </div>
        </section>

        {/* What creators get */}
        <section className="mt-24">
          <h2 className="text-2xl font-medium text-text">What you get</h2>
          <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
            {CREATOR.benefits.map((b) => (
              <div key={b.title} className="bg-surface p-6">
                <p className="text-base text-text">{b.title}</p>
                <p className="mt-2 text-sm leading-6 text-text-2">{b.title === "Higher revenue share" ? `Up to ${SHARE}% of the trading fees from your audience, above the public referral tiers` : b.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works, with a worked example */}
        <section className="mt-24 grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <div>
            <h2 className="text-2xl font-medium text-text">How it works</h2>
            <ol className="mt-6 flex flex-col">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-5 border-t border-border py-6 last:border-b">
                  <span className="font-mono text-sm text-emerald">0{i + 1}</span>
                  <span>
                    <span className="block text-base text-text">{s.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-text-2">{s.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <EarningsExample />
        </section>

        {/* Rules */}
        <section className="mt-24">
          <h2 className="text-2xl font-medium text-text">Who can join</h2>
          <ul className="mt-6 grid gap-x-10 gap-y-4 md:grid-cols-2">
            {CREATOR.requirements.map((r) => (
              <li key={r} className="flex gap-3 border-t border-border pt-4 text-sm leading-6 text-text-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section className="mt-24 max-w-3xl">
          <h2 className="text-2xl font-medium text-text">Questions</h2>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base text-text">
                  {f.q}
                  <span className="font-mono text-muted transition-transform group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-7 text-text-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-24 flex flex-col items-start gap-4 border-t border-border pt-10 md:flex-row md:items-center md:justify-between">
          <p className="text-lg text-text">Ready to earn with your audience?</p>
          <div className="flex items-center gap-4">
            <a href="#apply" className="flex h-11 items-center rounded-lg bg-text px-5 text-sm font-medium text-bg hover:opacity-90">
              Apply now
            </a>
            <Link href="/rewards" className="text-sm text-text-2 hover:text-text">
              Referral and cashback
            </Link>
          </div>
        </section>
        <p className="mt-10 max-w-3xl text-xs leading-5 text-muted">
          Shares and rules may change before launch and are confirmed when you are approved. Earnings depend on how much your audience trades. Trading crypto assets carries a high risk of loss
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
