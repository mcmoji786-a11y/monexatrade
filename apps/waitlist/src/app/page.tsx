import Image from "next/image";
import { JoinForm } from "@/components/join-form";
import { ListCount } from "@/components/list-count";
import { AI_FREE, BASE_FEE_PCT, OFFERS, feeAfter } from "@/lib/offers";

const TAPE = ["AI agent that auto-trades", "100,000+ strategies", "3 years of market data", "Fast engine", "Every coin's risk in plain sight", "Dev · Sniper · Bundler labels", "$10,000 demo at live prices"];

const FEATURES: { n: string; title: string; body: string; icon: React.ReactNode; soon?: boolean }[] = [
  {
    n: "01",
    title: "Every launch, the second it happens",
    body: "pump.fun, letsbonk.fun, Bags, Moonshot, Meteora and more on one radar, priced from on-chain trades.",
    icon: <path d="M12 12 19 5M21 12a9 9 0 1 1-9-9M16.5 12A4.5 4.5 0 1 1 12 7.5" />,
  },
  {
    n: "02",
    title: "A safety score on every coin",
    body: "Mint and freeze authority, top holders, dev share, bundled wallets, snipers and the dev's past coins, in one number.",
    icon: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4" />,
  },
  {
    n: "03",
    title: "Know who is trading",
    body: "Every wallet labelled: dev, sniper, bundler, whale, smart money. One tap tracks any of them.",
    icon: <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01" />,
  },
  {
    n: "04",
    title: "Copy trading that protects you",
    body: "Backtest a wallet before you copy it, start on demo, and get warned about wallets that win while their copiers lose.",
    icon: <path d="M8 8h11v11H8zM5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" />,
  },
  {
    n: "05",
    title: "Practise with $10,000, free",
    body: "A demo account at live prices with real fees and price impact, so your results are honest before you risk a single SOL.",
    icon: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  },
  {
    n: "06",
    title: "Kixo AI",
    body: "An agent that reads every coin and wallet and auto-trades within your limits, choosing from 100,000+ strategies.",
    icon: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2M9 9h6v6H9z" />,
    soon: true,
  },
];

const STEPS = [
  ["Spot it", "A new coin launches. Kixo has it on the radar in a second."],
  ["Check it", "Safety score, dev history, bundlers and snipers, before you click buy."],
  ["Practise it", "Try the trade on your free demo account at the live price."],
  ["Trade it", "When you are ready, with orders, stop losses and a trailing stop."],
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function Page() {
  return (
    <main>
      <div className="grid-bg" aria-hidden="true" />
      <header className="nav">
        <a href="#top" className="brand">
          <Image src="/kixo-mark.png" alt="" width={34} height={34} priority />
          Kixo
        </a>
        <a href="#join" className="nav-cta">
          Get early access
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-text">
          <p className="eyebrow">
            <span className="dot" /> Launching soon · Kixo AI for Solana
          </p>
          <h1>
            The AI that trades
            <br />
            <span className="accent">memecoins for you.</span>
          </h1>
          <p className="lead">
            Kixo's AI agent auto-trades Solana memecoins within your rules, choosing from 100,000+ strategies trained on 3 years of market data. On a fast engine, with every coin's risk in plain sight.
          </p>
          <div className="hero-stats">
            <div>
              <b>100,000+</b>
              <span>AI strategies</span>
            </div>
            <div>
              <b>3 years</b>
              <span>of market data</span>
            </div>
            <div>
              <b>Every coin</b>
              <span>risk-checked</span>
            </div>
          </div>
          <a href="#offers" className="offer-hint">
            <b>Early access:</b> the AI agent free for 1 year + up to 50% off trading fees
          </a>
          <JoinForm id="join" />
          <ListCount />
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="radar">
            <div className="sweep" />
            <i className="ring r1" />
            <i className="ring r2" />
            <i className="ring r3" />
            <b className="blip b1" />
            <b className="blip b2" />
            <b className="blip b3" />
            <b className="blip b4" />
          </div>
          <Image src="/hero.png" alt="" width={900} height={760} className="hero-shot" priority />
        </div>
      </section>

      <div className="tape" aria-hidden="true">
        <div className="tape-track">
          {[0, 1].map((k) => (
            <span key={k}>
              {TAPE.map((t) => (
                <span key={t}>
                  {t} <i>●</i>{" "}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <section className="pillars" id="ai">
        <p className="eyebrow">
          <span className="dot" /> What is coming
        </p>
        <h2>
          Three things Kixo is built on.
          <br />
          <span className="muted">One of them trades for you.</span>
        </h2>
        <div className="pillar-grid">
          <article className="pillar big">
            <span className="p-n">01 · The AI agent</span>
            <h3>An AI agent that auto-trades for you</h3>
            <p>It watches every new coin and every wallet, picks the strategy that fits the moment and trades within the limits you set: how much per trade, your daily loss limit, the minimum safety score. Every trade comes with its reason. You stay in control and can stop it with one click.</p>
            <div className="p-stats">
              <div>
                <b>100,000+</b>
                <span>strategies</span>
              </div>
              <div>
                <b>3 years</b>
                <span>of market data</span>
              </div>
              <div>
                <b>24/7</b>
                <span>watching the chain</span>
              </div>
            </div>
          </article>
          <article className="pillar">
            <span className="p-n">02 · Fast engine</span>
            <h3>Built for speed</h3>
            <p>Every launch on the radar the second it happens, prices from on-chain trades, and orders that go out fast with stop losses and trailing stops.</p>
          </article>
          <article className="pillar">
            <span className="p-n">03 · See the risk</span>
            <h3>The rug, before you buy</h3>
            <p>A safety score on every coin, plus the dev's past coins, bundled wallets, snipers and whales, labelled where you trade.</p>
          </article>
        </div>
      </section>

      <section className="offers" id="offers">
        <p className="eyebrow">
          <span className="dot" /> Early access offer
        </p>
        <h2>
          Join early. <span className="accent">Get the AI free for a year.</span>
        </h2>
        <div className="ai-free">
          <span className="ai-free-badge">For everyone on the list</span>
          <p className="ai-free-title">
            <b>1 year free</b> · Kixo AI Agent
          </p>
          <p className="ai-free-body">{AI_FREE.body} Plus a discount on every trade below: invite friends to unlock more.</p>
        </div>
        <ol className="offer-grid">
          {OFFERS.map((o, i) => (
            <li key={o.key} className={i === 2 ? "top" : ""}>
              <span className="o-step">{String(i + 1).padStart(2, "0")} · {o.how}</span>
              <h3>{o.name}</h3>
              <p className="o-off">
                <b>{o.off}%</b> off
              </p>
              <p className="o-detail">
                Trading fee {feeAfter(o)}% instead of {BASE_FEE_PCT}%, for {o.months} months{o.extra ? ` + ${o.extra}` : ""}
              </p>
            </li>
          ))}
        </ol>
        <p className="o-terms">The discount is on Kixo&apos;s own trading fee, not Solana network fees. It starts when real trading opens on your Kixo account, using the email you join with. One fee offer per person: the best one you reach. The free year of the AI agent starts the day it opens on your account.</p>
      </section>

      <section className="features">
        <h2>
          Built for the trenches.
          <br />
          <span className="muted">Made to keep you out of the traps.</span>
        </h2>
        <ul>
          {FEATURES.map((f) => (
            <li key={f.n} className={f.soon ? "soon" : ""}>
              <div className="f-top">
                <span className="f-icon">
                  <Icon>{f.icon}</Icon>
                </span>
                <span className="f-n">{f.n}</span>
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="steps">
        <h2>From launch to trade in four moves</h2>
        <ol>
          {STEPS.map(([t, b], i) => (
            <li key={t}>
              <span className="s-n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{t}</h3>
              <p>{b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="ai">
        <p className="eyebrow">
          <span className="dot" /> Training now
        </p>
        <h2>
          Kixo AI is <span className="accent">learning the trenches.</span>
        </h2>
        <p className="lead">
          Every launch, every trade and how every coin ended is going into it right now. Kixo opens when the AI is ready, and the waitlist gets in first.
        </p>
      </section>

      <section className="final">
        <h2>Be first in.</h2>
        <p className="lead">Join the waitlist. Invite friends to move up.</p>
        <JoinForm id="join-2" />
      </section>

      <footer className="foot">
        <span>© 2026 Kixo</span>
        <span>Kixo is in development and not open yet. Not financial advice. Memecoins are very risky and most lose value.</span>
      </footer>
    </main>
  );
}
