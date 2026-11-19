import { KixoLogo } from "@/components/brand";
import { SocialLinks } from "@/components/marketing/marketing-ui";
import Link from "next/link";
import { Bell, Check, Crosshair, KeyRound, Radar, Receipt, ShieldCheck, Sparkle, Users, Wallet, type LucideIcon } from "lucide-react";
import { VerdictLegend } from "./live-preview";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "./reveal";
import { GUIDES } from "@/lib/guides";

/* ---------- shared ---------- */

function SectionHead({ id, eyebrow, title, body }: { id: string; eyebrow: string; title: string; body?: string }) {
  return (
    <Reveal>
      <div id={id} className="max-w-2xl scroll-mt-24">
        <div className="font-mono text-xs text-emerald">{eyebrow}</div>
        <h2 className="mt-3 text-3xl font-medium leading-tight text-text md:text-4xl">{title}</h2>
        {body && <p className="mt-4 text-base leading-7 text-text-2">{body}</p>}
      </div>
    </Reveal>
  );
}

/* ---------- features ---------- */

type Feature = { icon: LucideIcon; title: string; body: string; items: string[]; wide?: boolean; moment?: "verdicts" | "demo" };

/** Everything here works today on the demo account. Keep it true. */
const FEATURES: Feature[] = [
  {
    icon: Radar,
    title: "Sol Radar and Discover",
    body: "Every new Solana coin the second it launches, from pump.fun, letsbonk, Bags, Meteora, Moonshot and direct mints.",
    items: ["Holders, dev share, bundles and early buyers on every card", "Creator record: rugged, died fast or graduated", "Wallet labels: Dev, Smart, Whale, Bundler, Sniper", "Quick Buy from any row"],
    wide: true,
  },
  {
    icon: Sparkle,
    title: "Kixo AI",
    body: "Its own model, trained on 487,368 launches, gives every new coin one word after 2 minutes.",
    items: ["AI analysis: the good, the bad and a plain call", "Chat that knows the dev wallet, bundlers and holders"],
    moment: "verdicts",
  },
  {
    icon: Crosshair,
    title: "Sniper",
    body: "Buys new coins the moment they match your rules, with safety, dev, bundle and AI filters.",
    items: ["Test your rules on the last 24 hours of real launches", "Strategy Library, tested daily"],
  },
  {
    icon: Users,
    title: "Smart Money and copy trading",
    body: "Follow the wallets that actually make money and copy their buys and sells, starting on demo.",
    items: ["Wallet Tracker and Wallet Monitor", "KOL and X Tracker"],
  },
  {
    icon: Wallet,
    title: "Demo account",
    body: "Start with $10,000 of virtual money at live prices, with real fees and price impact.",
    items: ["Weekly competition, same start for everyone", "Profit calendar, streaks and share cards"],
    moment: "demo",
  },
  {
    icon: ShieldCheck,
    title: "Guard rails",
    body: "Rug exit sells a demo position when the dev sells or the AI says Danger, even with Kixo closed.",
    items: ["Daily loss limit", "A warning when you buy a Danger coin", "Stop loss, trailing stop and limit orders"],
  },
  {
    icon: Bell,
    title: "Alerts and news",
    body: "Price alerts, wallet trades and dev sells by Email, Telegram or Discord, and news from the last 48 hours only.",
    items: ["2x, 5x and 10x alerts", "On-chain events in the news feed"],
    wide: true,
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-300 px-4 py-20 md:px-8">
      <SectionHead id="features" eyebrow="Features" title="Everything a Solana memecoin trader needs, on one screen" body="All of it works today on the demo account. Real-SOL trading opens after its security review" />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 60} className={f.wide ? "md:col-span-2" : ""}>
            <FeatureCard f={f} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function FeatureCard({ f }: { f: Feature }) {
  const Icon = f.icon;
  return (
    <article className="flex h-full flex-col rounded-2xl border border-border bg-surface p-6">
      <Icon size={18} strokeWidth={1.5} className="text-text-2" />
      <h3 className="mt-5 text-lg font-medium text-text">{f.title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-2">{f.body}</p>
      {f.moment === "verdicts" && (
        <div className="mt-5">
          <VerdictLegend />
        </div>
      )}
      {f.moment === "demo" && (
        <div className="mt-5 rounded-xl border border-border bg-bg px-4 py-3">
          <p className="text-xs text-warning">Demo account</p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-text">$10,000.00</p>
        </div>
      )}
      <ul className={`mt-auto grid gap-x-6 gap-y-2 pt-6 text-sm text-text-2 ${f.wide ? "sm:grid-cols-2" : ""}`}>
        {f.items.map((x) => (
          <li key={x} className="flex gap-2">
            <Check size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" />
            {x}
          </li>
        ))}
      </ul>
    </article>
  );
}

/* ---------- on-chain data ---------- */

const DATA_POINTS = [
  { k: "Launches", v: "Every new Solana coin, from pump.fun, letsbonk, Bags, Meteora, Moonshot and direct mints, the moment its create transaction confirms" },
  { k: "Prices", v: "Computed from bonding curve reserves after every trade, not copied from another site" },
  { k: "SOL price", v: "Read from the vaults of Raydium's SOL/USDC pool" },
  { k: "Clean feed", v: "Tokens without trading activity leave the radar on their own" },
];

/** Data, security and fees side by side: three reasons in one compact section. */
export function WhyKixo() {
  return (
    <section className="mx-auto max-w-300 px-4 py-20 md:px-8">
      <SectionHead id="why" eyebrow="Why Kixo" title="Built for the trenches, not for show" />
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <Reveal className="h-full">
          <article id="data" className="flex h-full scroll-mt-24 flex-col rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-lg font-medium text-text">Read from the chain, not resold</h3>
            <p className="mt-2 text-sm leading-6 text-text-2">Kixo runs its own decoders for Solana programs. Estimates are labelled as estimates</p>
            <dl className="mt-6 flex flex-col divide-y divide-border border-t border-border">
              {DATA_POINTS.map((d) => (
                <div key={d.k} className="py-3">
                  <dt className="text-sm text-text">{d.k}</dt>
                  <dd className="mt-1 text-xs leading-5 text-text-2">{d.v}</dd>
                </div>
              ))}
            </dl>
          </article>
        </Reveal>
        <Reveal delay={60} className="h-full">
          <article id="security" className="flex h-full scroll-mt-24 flex-col rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-lg font-medium text-text">Your keys never leave you</h3>
            <p className="mt-2 text-sm leading-6 text-text-2">Real-SOL trading opens only after an independent security review. Until then, practise on the demo account</p>
            <ul className="mt-6 flex flex-col gap-5 border-t border-border pt-5">
              {SECURITY.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <Icon size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-2" />
                  <div>
                    <p className="text-sm text-text">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-text-2">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </Reveal>
        <Reveal delay={120} className="h-full">
          <article id="fees" className="flex h-full scroll-mt-24 flex-col rounded-2xl border border-border bg-surface p-6">
            <h3 className="text-lg font-medium text-text">One flat fee</h3>
            <p className="mt-6 font-mono text-7xl tabular-nums text-text">0.5%</p>
            <p className="mt-2 text-sm text-text-2">a trade, where most terminals charge about 1%</p>
            <ul className="mt-auto flex flex-col gap-2 border-t border-border pt-5 text-sm text-text-2">
              {["No subscription, no hidden spread", "Deposits free, withdrawals 0.5%", "Network fees go to Solana, not to Kixo"].map((x) => (
                <li key={x} className="flex gap-2">
                  <Check size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" />
                  {x}
                </li>
              ))}
            </ul>
          </article>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- security ---------- */

const SECURITY: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: KeyRound, title: "Your keys stay yours", body: "Kixo never asks for a seed phrase or private key. Funds stay in your wallet." },
  { icon: ShieldCheck, title: "Locked in your browser", body: "Your Kixo wallet is made and locked in your own browser with a password only you know. Kixo stores only the locked copy, which it cannot open." },
  { icon: Receipt, title: "Simulated first", body: "Transactions are simulated before you sign, so obvious failures are caught early." },
];

/* ---------- FAQ ---------- */

/** Also published as FAQ structured data on the landing page, so keep each answer true. */
export const FAQ = [
  {
    q: "What is Kixo?",
    a: "Kixo is a Solana memecoin trading terminal. It shows every new token the second it launches, scores each coin on checks it can verify, and puts trading, a sniper, smart money, wallet tracking and live on-chain news on one screen.",
  },
  {
    q: "What can I use today?",
    a: "Discover, Sol Radar, coin pages with charts and safety scores, Kixo AI (its word on every new coin, AI analysis and chat), the sniper, Smart Money and copy trading, the Wallet Tracker and Monitor, Rug exit, alerts, live news and a free demo account that trades at live prices with real fees. Real-SOL trading opens after its security review.",
  },
  {
    q: "Can I practise without real money?",
    a: "Yes. Every account starts with a demo balance that buys and sells at live market prices, with the same fees and price impact as a real trade, so the result you see is what the trade would really have made.",
  },
  {
    q: "How does Kixo AI decide Danger?",
    a: "Kixo trained its own model on hundreds of thousands of Solana launches. For each new coin it reads the first 2 minutes of trades and who bought early, including those wallets' record on earlier coins, and gives the chance the coin crashes 70% or more, or doubles, within the hour. It is best at warning you off a coin; it is never a promise that a coin goes up.",
  },
  {
    q: "Does Kixo hold my funds?",
    a: "No. Your Kixo trading wallet is created in your own browser and locked with a wallet password only you know. Kixo stores only the locked copy, which it cannot open, and never asks for a seed phrase.",
  },
  {
    q: "What does Kixo charge?",
    a: "0.5% per trade and 0.5% on withdrawals. Deposits are free. Solana network fees are separate and shown before you confirm.",
  },
  {
    q: "Which tokens appear on Sol Radar?",
    a: "Every new Solana coin with a name: pump.fun, letsbonk.fun and other Raydium LaunchLab sites, Bags and other Meteora curves, Moonshot, and coins minted directly. pump.fun coins are priced from our own decoder; the others use market data until their decoders ship.",
  },
  {
    q: "Why are holder counts marked as approximate?",
    a: "Holders are counted from the trades Kixo observes after launch. Direct wallet-to-wallet transfers are not trades, so the count can differ slightly.",
  },
  {
    q: "Is a token on Sol Radar a recommendation?",
    a: "No. Sol Radar shows what is happening on chain. Most new tokens lose their value, so never trade more than you can afford to lose.",
  },
];

export function Faq() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-300 gap-12 px-4 py-20 md:px-8 lg:grid-cols-[1fr_1.4fr]">
        <SectionHead id="faq" eyebrow="FAQ" title="Questions people ask first" />
        <div className="divide-y divide-border border-y border-border">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base text-text">
                {f.q}
                <span className="font-mono text-muted transition-transform duration-200 group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-xl text-sm leading-6 text-text-2">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- final call to action + footer ---------- */

export function FinalCta() {
  return (
    <section className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-300 flex-col items-start gap-8 px-4 py-28 md:flex-row md:items-center md:justify-between md:px-8">
        <div>
          <h2 className="max-w-2xl text-4xl font-medium leading-tight text-text md:text-5xl">Catch the next launch. Skip the next rug</h2>
          <p className="mt-2 text-text-2">Free to use. Sign up with Google or email and start with $10,000 of demo money</p>
        </div>
        <ButtonLink href="/discover" size="lg">
          Start with $10,000 demo
        </ButtonLink>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-300 px-4 py-12 md:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <KixoLogo size={24} />
          <nav className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-text-2" aria-label="Footer">
            <Link href="/discover" className="hover:text-text">Discover</Link>
            <Link href="/radar" className="hover:text-text">Sol Radar</Link>
            <Link href="/#features" className="hover:text-text">Features</Link>
            <Link href="/#ai" className="hover:text-text">Kixo AI</Link>
            <Link href="/#security" className="hover:text-text">Security</Link>
            <Link href="/#fees" className="hover:text-text">Fees</Link>
            <Link href="/learn" className="hover:text-text">Learn</Link>
            <Link href="/#faq" className="hover:text-text">FAQ</Link>
          </nav>
        </div>
        <nav className="mt-10 border-t border-border pt-8" aria-label="Guides">
          <p className="text-xs text-muted">Guides</p>
          <ul className="mt-3 grid gap-x-8 gap-y-2 text-sm text-text-2 sm:grid-cols-2 lg:grid-cols-3">
            {GUIDES.map((g) => (
              <li key={g.slug}>
                <Link href={`/learn/${g.slug}`} className="hover:text-text">
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-8">
          <SocialLinks />
        </div>
        <p className="mt-10 max-w-3xl text-xs leading-5 text-muted">
          Trading crypto assets carries a high risk of loss. Nothing on Kixo is financial advice. Data is
          provided as is, and estimates are labelled as estimates.
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
          <span>© 2026 Kixo</span>
          <Link href="/terms" className="hover:text-text">Terms of Use</Link>
          <Link href="/privacy" className="hover:text-text">Privacy Policy</Link>
        </p>
      </div>
    </footer>
  );
}
