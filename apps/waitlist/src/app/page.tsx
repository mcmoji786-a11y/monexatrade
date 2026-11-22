import type { Metadata } from "next";
import Image from "next/image";
import { Access } from "@/components/access";
import { ListCount } from "@/components/list-count";
import { Leaderboard } from "@/components/leaderboard";
import { LiveBoard, LiveTicker } from "@/components/live";
import { Count, Reveal } from "@/components/motion";
import { MobileCta } from "@/components/mobile-cta";
import { PassButton } from "@/components/pass-button";
import { AI_FREE, BASE_FEE_PCT, OFFERS, feeAfter } from "@/lib/offers";
import { FAQ, jsonLd } from "@/lib/seo";

/** An invite link (`/?ref=code`) shows the inviter's own card as its preview on X,
 *  Telegram and the rest. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ ref?: string }> }): Promise<Metadata> {
  const ref = (await searchParams).ref?.trim().toLowerCase();
  // A code or a Kixo name (kixo.trade/?ref=aliraza).
  if (!ref || !/^@?[a-z0-9_]{3,20}$/.test(ref)) return {};
  const image = { url: `/api/card?code=${encodeURIComponent(ref)}`, width: 1200, height: 630 };
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
        <PassButton className="nav-cta">Get your pass</PassButton>
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
        <PassButton className="btn-primary big">Get your pass</PassButton>
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
