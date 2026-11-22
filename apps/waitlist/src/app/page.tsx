import type { Metadata } from "next";
import Image from "next/image";
import { Access } from "@/components/access";
import { ListCount } from "@/components/list-count";
import { Leaderboard } from "@/components/leaderboard";
import { LiveBoard, LiveTicker } from "@/components/live";
import { Count, Reveal } from "@/components/motion";
import { MobileCta } from "@/components/mobile-cta";
import { AI_FREE, BASE_FEE_PCT, OFFERS, feeAfter } from "@/lib/offers";
import { FAQ, jsonLd } from "@/lib/seo";

const FEATURES: { title: string; body: string; icon: React.ReactNode; soon?: boolean }[] = [
  { title: "Every launch, the second it happens", body: "pump.fun, letsbonk.fun, Bags, Moonshot, Meteora and more on one radar, priced from on-chain trades.", icon: <path d="M12 12 19 5M21 12a9 9 0 1 1-9-9M16.5 12A4.5 4.5 0 1 1 12 7.5" /> },
  { title: "A safety score on every coin", body: "Mint and freeze authority, top holders, dev share, bundled wallets, snipers and the dev's past coins, in one number.", icon: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4" /> },
  { title: "Know who is trading", body: "Every wallet labelled: dev, sniper, bundler, whale, smart money. One tap tracks any of them.", icon: <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01" /> },
  { title: "Copy trading that protects you", body: "Backtest a wallet before you copy it, start on demo, and get warned about wallets that win while their copiers lose.", icon: <path d="M8 8h11v11H8zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" /> },
  { title: "Practise with $10,000, free", body: "A demo account at live prices with real fees and price impact, so your results are honest before you risk a single SOL.", icon: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" /> },
  { title: "Kixo AI", body: "An agent that reads every coin and wallet and auto-trades within your limits, choosing from 100,000+ strategies.", icon: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2M9 9h6v6H9z" />, soon: true },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** An invite link (`/?ref=code`) shows the inviter's own card as its preview on X,
 *  Telegram and the rest. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ ref?: string }> }): Promise<Metadata> {
  const ref = (await searchParams).ref?.trim().toLowerCase();
  if (!ref || !/^[a-z0-9]{6,12}$/.test(ref)) return {};
  const image = { url: `/api/card?code=${ref}`, width: 1200, height: 630 };
  const title = "Join me on the Kixo waitlist";
  const description = "Kixo AI auto-trades Solana memecoins for you. Join early: the AI agent free for 1 year.";
  return { title, description, openGraph: { title, description, images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image.url] } };
}

export default function Page() {
  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()).replace(/</g, "\\u003c") }} />
      <Reveal />
      <header className="nav">
        <a href="#top" className="brand">
          <Image src="/kixo-mark.png" alt="" width={28} height={28} priority />
          Kixo
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#inside">Inside</a>
          <a href="#offers">Offers</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a href="#join" className="nav-cta">
          Get your pass
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-head">
          <p className="eyebrow">
            <span className="live" aria-hidden="true" /> Launching soon · Solana
          </p>
          <h1>
            The AI that trades <span className="accent">memecoins for you</span>
          </h1>
          <p className="lead">Kixo&apos;s AI agent auto-trades Solana memecoins within your rules, choosing from 100,000+ strategies trained on 3 years of market data. On a fast engine, with every coin&apos;s risk in plain sight.</p>
          <dl className="hero-stats">
            <div>
              <dt>AI strategies</dt>
              <dd>
                <Count to={100000} suffix="+" />
              </dd>
            </div>
            <div>
              <dt>Years of market data</dt>
              <dd>
                <Count to={3} ms={900} />
              </dd>
            </div>
            <div>
              <dt>Launchpads watched</dt>
              <dd>
                <Count to={6} ms={900} />
              </dd>
            </div>
          </dl>
          <ListCount />
        </div>
        <Access />
      </section>

      <LiveTicker />

      <section className="live-section" id="live">
        <div className="section-head" data-reveal>
          <p className="eyebrow">
            <span className="live" aria-hidden="true" /> Solana, right now
          </p>
          <h2>Every coin, the second it moves</h2>
          <p className="lead">The newest launches and the memecoins moving this minute, with the quick checks Kixo runs on every one. Live data, refreshed every 15 seconds.</p>
        </div>
        <div data-reveal>
          <LiveBoard />
        </div>
        <p className="terms">Live Solana data via Jupiter. Mint and freeze show whether the creator can still print or lock tokens; top 10 is the share the ten biggest wallets hold. Not advice: most new coins go to zero.</p>
      </section>


      <section className="inside" id="inside">
        <div className="section-head" data-reveal>
          <p className="eyebrow">Inside Kixo</p>
          <h2>A terminal built for the trenches</h2>
          <p className="lead">The chart, the safety read and copy trading, as they look in Kixo today.</p>
        </div>
        <div className="shot" data-reveal>
          <Image src="/hero.png" alt="The Kixo terminal: a live chart, a safety read of a coin, copy-trading settings and a new launch card" width={1800} height={1520} sizes="(max-width: 900px) 100vw, 1100px" />
        </div>
      </section>

      <section className="pillars" id="ai">
        <div className="section-head" data-reveal>
          <p className="eyebrow">What is coming</p>
          <h2>Three things Kixo is built on. One of them trades for you</h2>
        </div>
        <div className="pillar-grid stagger" data-reveal>
          <article className="pillar big">
            <span className="p-n">01 · The AI agent</span>
            <h3>An AI agent that auto-trades for you</h3>
            <p>It watches every new coin and every wallet, picks the strategy that fits the moment and trades within the limits you set: how much per trade, your daily loss limit, the minimum safety score. Every trade comes with its reason, and one click stops it.</p>
            <dl className="p-stats">
              <div>
                <dt>Strategies</dt>
                <dd>
                  <Count to={100000} suffix="+" />
                </dd>
              </div>
              <div>
                <dt>Market data</dt>
                <dd>
                  <Count to={3} suffix=" years" ms={900} />
                </dd>
              </div>
              <div>
                <dt>Watching the chain</dt>
                <dd>24/7</dd>
              </div>
            </dl>
          </article>
          <article className="pillar">
            <span className="p-n">02 · Fast engine</span>
            <h3>Built for speed</h3>
            <p>Every launch on the radar the second it happens, prices from on-chain trades, and orders that go out fast with stop losses and trailing stops.</p>
          </article>
          <article className="pillar">
            <span className="p-n">03 · See the risk</span>
            <h3>The rug, before you buy</h3>
            <p>A safety score on every coin, plus the dev&apos;s past coins, bundled wallets, snipers and whales, labelled where you trade.</p>
          </article>
        </div>
      </section>

      <section className="offers" id="offers">
        <div className="section-head" data-reveal>
          <p className="eyebrow">Early access</p>
          <h2>Join early. Get the AI free for a year</h2>
          <p className="lead">{AI_FREE.body} On top of that, a discount on every trade: invite friends to unlock more.</p>
        </div>
        <ol className="ladder stagger" data-reveal>
          {OFFERS.map((o, i) => (
            <li key={o.key} className={i === 2 ? "top" : ""}>
              <span className="l-step">{o.how}</span>
              <h3>{o.name}</h3>
              <p className="l-off">
                <Count to={o.off} suffix="%" ms={1100} /> <span>off fees</span>
              </p>
              <p className="l-detail">
                {feeAfter(o)}% instead of {BASE_FEE_PCT}% for {o.months} months{o.extra ? `, plus the ${o.extra}` : ""}
              </p>
            </li>
          ))}
        </ol>
        <p className="terms">The discount is on Kixo&apos;s own trading fee, not Solana network fees, and starts when real trading opens on your Kixo account. One fee offer per person: the best one you reach. The free year of the AI agent starts the day it opens on your account.</p>
      </section>

      <section className="leaders" id="leaderboard">
        <div className="section-head" data-reveal>
          <p className="eyebrow">
            <span className="live" aria-hidden="true" /> Leaderboard
          </p>
          <h2>Bring the most friends, win the most</h2>
          <p className="lead">Every friend who joins with your link moves you up 3 places, unlocks bigger offers and is a ticket in the gift draw.</p>
        </div>
        <div data-reveal>
          <Leaderboard />
        </div>
      </section>

      <section className="features">
        <div className="section-head" data-reveal>
          <h2>Made to keep you out of the traps</h2>
        </div>
        <ul className="stagger" data-reveal>
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="f-icon">
                <Icon>{f.icon}</Icon>
              </span>
              <h3>
                {f.title}
                {f.soon && <span className="soon">Training now</span>}
              </h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ul>
      </section>


      <section className="faq" id="faq">
        <div className="section-head" data-reveal>
          <h2>Questions</h2>
        </div>
        <div className="faq-list" data-reveal>
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="final" data-reveal>
        <h2>Be first in</h2>
        <p className="lead">Claim your pass, share your link, move up the list.</p>
        <a href="#join" className="btn-primary big">
          Get your pass
        </a>
      </section>

      {/* Phones: the way in stays one thumb away. */}
      <MobileCta />

      <footer className="foot">
        <span>© 2026 Kixo</span>
        <span>Kixo is in development and not open yet. Not financial advice. Memecoins are very risky and most lose value.</span>
      </footer>
    </main>
  );
}
