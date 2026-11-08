import { KixoLogo } from "@/components/brand";
import { SocialLinks } from "@/components/marketing/marketing-ui";
import Link from "next/link";
import { KeyRound, Receipt, ShieldCheck, type LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FEATURE_COUNTS, FeatureExplorer } from "./feature-explorer";
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

export function Features() {
  const c = FEATURE_COUNTS;
  return (
    <section className="mx-auto max-w-300 px-4 py-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <SectionHead
          id="features"
          eyebrow="Features"
          title="Everything a Solana trader needs, in one terminal"
          body="The full Kixo platform, grouped the way you trade. Each feature shows whether it is live today, in development or planned."
        />
        <Reveal delay={120}>
          <dl className="flex gap-8 font-mono">
            <Count label="Features" value={c.total} />
            <Count label="Live" value={c.live} accent />
            <Count label="In development" value={c.building} />
            <Count label="Planned" value={c.planned} />
          </dl>
        </Reveal>
      </div>
      <Reveal delay={80}>
        <FeatureExplorer />
      </Reveal>
    </section>
  );
}

function Count({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 font-sans text-xs text-muted">{label}</dt>
      <dd className={`text-3xl ${accent ? "text-emerald" : "text-text"}`}>{value}</dd>
    </div>
  );
}

/* ---------- how it works ---------- */

const STEPS = [
  {
    n: "01",
    title: "Spot",
    body: "Watch launches arrive on Sol Radar. Filter by socials, holders or concentration, or paste a contract address.",
  },
  {
    n: "02",
    title: "Check",
    body: "See how much the top ten wallets and the creator hold, how many wallets trade it and whether a symbol is a copy.",
  },
  {
    n: "03",
    title: "Trade",
    body: "Buy or sell from your own wallet. You approve every transaction yourself. Trading is the next milestone.",
  },
];

export function HowItWorks() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-300 px-4 py-24 md:px-8">
        <SectionHead id="how" eyebrow="How it works" title="From launch to decision in three steps" />
        <ol className="mt-12 grid gap-10 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n}>
              <Reveal delay={i * 60} className="border-t border-border pt-6">
                <div className="font-mono text-sm text-muted">{s.n}</div>
                <h3 className="mt-3 text-xl font-medium text-text">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-text-2">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- on-chain data ---------- */

const DATA_POINTS = [
  { k: "Launches", v: "Every new Solana coin, from pump.fun, letsbonk, Bags, Meteora, Moonshot and direct mints, the moment its create transaction confirms" },
  { k: "Prices", v: "Computed from bonding curve reserves after every trade, not copied from another site" },
  { k: "SOL price", v: "Read from the vaults of Raydium's SOL/USDC pool" },
  { k: "Clean feed", v: "Tokens without trading activity leave the radar on their own" },
];

export function ChainData() {
  return (
    <section className="mx-auto grid max-w-300 gap-12 px-4 py-24 md:px-8 lg:grid-cols-2 lg:items-start">
      <SectionHead
        id="data"
        eyebrow="Data"
        title="Read from the chain, not resold"
        body="Kixo runs its own decoders for Solana programs. The numbers you see are worked out from on-chain events, and estimates are labelled as estimates."
      />
      <dl className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {DATA_POINTS.map((d) => (
          <div key={d.k} className="grid gap-1 px-6 py-5 sm:grid-cols-[120px_1fr] sm:gap-6">
            <dt className="text-sm font-medium text-text">{d.k}</dt>
            <dd className="text-sm leading-6 text-text-2">{d.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------- security ---------- */

const SECURITY: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: KeyRound, title: "Your keys stay yours", body: "Kixo never asks for a seed phrase or private key. Funds stay in your wallet." },
  { icon: ShieldCheck, title: "You sign every trade", body: "Each trade is signed by your own key: your Kixo wallet, locked in your browser, or Phantom." },
  { icon: Receipt, title: "Simulated first", body: "Transactions are simulated before you sign, so obvious failures are caught early." },
];

export function Security() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-300 px-4 py-24 md:px-8">
        <SectionHead
          id="security"
          eyebrow="Security"
          title="Non-custodial by design"
          body="Real-money trading opens only after an independent security review. Until then Kixo shows data and never moves funds."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {SECURITY.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 60} className="rounded-2xl border border-border bg-bg p-6">
              <Icon size={18} strokeWidth={1.5} className="text-text-2" />
              <h3 className="mt-5 text-base font-medium text-text">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-2">{body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- fees ---------- */

export function Fees() {
  return (
    <section className="mx-auto max-w-300 px-4 py-24 md:px-8">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
        <SectionHead
          id="fees"
          eyebrow="Fees"
          title="One flat fee, shown before you approve"
          body="No subscription and no hidden spread. Solana network fees go to the network, not to Kixo."
        />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          {[
            { k: "Buy", v: "0.5%" },
            { k: "Sell", v: "0.5%" },
          ].map((f) => (
            <div key={f.k} className="bg-surface p-8">
              <div className="text-sm text-muted">{f.k}</div>
              <div className="mt-2 font-mono text-5xl text-text">{f.v}</div>
              <div className="mt-3 text-xs text-muted">of the trade amount</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

/** Also published as FAQ structured data on the landing page, so keep each answer true. */
export const FAQ = [
  {
    q: "What is Kixo?",
    a: "Kixo is a Solana memecoin trading terminal. It shows every new token the second it launches, scores each coin on checks it can verify, and puts trading, a sniper, smart money, wallet tracking and live on-chain news on one screen.",
  },
  {
    q: "What can I use today?",
    a: "Discover, Sol Radar, coin pages with charts and safety scores, the sniper, Smart Money, the Wallet Tracker and Monitor, live news and a free demo account that trades at live prices with real fees. Real-SOL trading opens after its security review.",
  },
  {
    q: "Can I practise without real money?",
    a: "Yes. Every account starts with a demo balance that buys and sells at live market prices, with the same fees and price impact as a real trade, so the result you see is what the trade would really have made.",
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
      <div className="mx-auto grid max-w-300 gap-12 px-4 py-24 md:px-8 lg:grid-cols-[1fr_1.4fr]">
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
      <div className="mx-auto flex max-w-300 flex-col items-start gap-6 px-4 py-20 md:flex-row md:items-center md:justify-between md:px-8">
        <div>
          <h2 className="text-3xl font-medium text-text">Watch the next launch land</h2>
          <p className="mt-2 text-text-2">Free to use. Sign up with Google or email and start with a demo account.</p>
        </div>
        <ButtonLink href="/discover" size="lg">
          Trade now
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
        <p className="mt-4 font-mono text-xs text-muted">© 2026 Kixo</p>
      </div>
    </footer>
  );
}
