"use client";

import { useEffect, useRef, useState } from "react";
import { feeAfter, nextStep, offerFor } from "@/lib/offers";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";
const SAVED = "kixo.waitlist";

/* Ready-to-post captions: honest (no profit promises), short, with a hook. */
const CAPTIONS = 4;
function captions(pos: number): string[] {
  const p = `#${pos.toLocaleString("en-US")}`;
  return [
    `I just locked in a free year of Kixo's AI trading agent 🤖\n\nAn AI that trades Solana memecoins for you: 100,000+ strategies, 3 years of market data, and it shows the rug before you buy.\n\nI'm ${p} on the waitlist. Join with my link and we both move up 👇`,
    `Most memecoins you buy are already rigged.\n\nKixo's AI sees the bundlers, snipers and dev dumps first, then trades for you.\n\n${p} on the waitlist. Early list gets the AI free for 1 year 👇`,
    `POV: you stop getting rugged in the trenches.\n\nKixo = an AI agent that auto-trades Solana memecoins within your rules. 100,000+ strategies.\n\nI'm ${p}. Free AI for a year if you join early 👇`,
    `The trenches are about to change. 🟢\n\nI'm ${p} on the Kixo waitlist: AI that trades memecoins for you, free for a year for early users.\n\nGrab your spot before it fills 👇`,
  ];
}

type Status = { code: string; position: number; total: number; referrals: number; rank: number };
type Api = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id: string) => void };
declare global {
  interface Window {
    turnstile?: Api;
  }
}

function loadTurnstile(): Promise<Api | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => res(window.turnstile ?? null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

/** Email in, place on the list out. Remembers the person in this browser so a return
 *  visit shows their place and referral link instead of the form. */
export function JoinForm({ id }: { id: string }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Status | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [variant, setVariant] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  // A returning visitor: show their place.
  useEffect(() => {
    let code: string | null = null;
    try {
      code = localStorage.getItem(SAVED);
    } catch {}
    if (!code) return;
    fetch(`/api/status?code=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then((s) => s && setMe(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!SITE_KEY || me) return;
    let alive = true;
    loadTurnstile().then((api) => {
      if (!alive || !api || !box.current || widget.current) return;
      widget.current = api.render(box.current, {
        sitekey: SITE_KEY,
        theme: "dark",
        size: "flexible",
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(""),
      });
    });
    return () => {
      alive = false;
    };
  }, [me]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const q = new URLSearchParams(window.location.search);
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, token, ref: q.get("ref"), source: q.get("utm_source") ?? q.get("src") }),
      });
      const v = (await res.json()) as Status & { error?: string };
      if (!res.ok) throw new Error(v.error ?? "Something went wrong");
      try {
        localStorage.setItem(SAVED, v.code);
      } catch {}
      setMe(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
      setToken("");
    } finally {
      setBusy(false);
    }
  }

  if (me) {
    const link = `${SITE || window.location.origin}/?ref=${me.code}`;
    const card = `/api/card?code=${me.code}`;
    const caption = captions(me.position)[variant % CAPTIONS];
    const copy = (what: string, text: string) =>
      navigator.clipboard.writeText(text).then(() => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1400);
      });
    const o = offerFor(me.referrals, me.rank ?? Number.MAX_SAFE_INTEGER);
    const next = nextStep(me.referrals, me.rank ?? Number.MAX_SAFE_INTEGER);
    return (
      <div className="joined" id={id}>
        <p className="joined-kicker">
          <span className="dot" /> You are on the list
        </p>
        <p className="joined-place">
          <span className="hash">#</span>
          {me.position.toLocaleString("en-US")}
        </p>
        <p className="joined-sub">
          of {me.total.toLocaleString("en-US")} traders{me.referrals > 0 ? ` · ${me.referrals} joined with your link` : ""}. Every friend who joins with your link moves you up 3 places
        </p>
        <div className="my-offer">
          <p className="my-offer-name">
            Your offer: <b>Kixo AI Agent free for 1 year</b> + <b>{o.name}</b>
          </p>
          <p className="my-offer-body">
            {o.off}% off Kixo&apos;s trading fee for {o.months} months ({feeAfter(o)}% instead of 0.5%){o.extra ? ` + ${o.extra}` : ""}
          </p>
          {next && (
            <p className="my-offer-next">
              {next.invites} more {next.invites === 1 ? "friend" : "friends"} to unlock <b>{next.offer.name}</b>: {next.offer.off}% off for {next.offer.months} months
            </p>
          )}
        </div>

        <div className="share-kit">
          <p className="share-title">Share your card</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="share-card" src={card} alt={`Kixo waitlist card #${me.position}`} width={1200} height={630} />
          <div className="caption">
            <pre>{caption}</pre>
            <div className="caption-actions">
              <button type="button" onClick={() => setVariant((v) => v + 1)}>
                Another caption
              </button>
              <button type="button" onClick={() => copy("caption", `${caption}\n\n${link}`)}>
                {copied === "caption" ? "Copied" : "Copy caption"}
              </button>
            </div>
          </div>
          <div className="share-buttons">
            <a className="x-share" href={`https://x.com/intent/post?text=${encodeURIComponent(caption)}&url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Post on X
            </a>
            <a className="alt-share" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(caption)}`} target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
            <a className="alt-share" href={card} download={`kixo-waitlist-${me.position}.png`}>
              Download card
            </a>
          </div>
          <div className="share">
            <input readOnly value={link} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={() => copy("link", link)}>
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="share-hint">Your link shows this card when you post it. For the biggest preview, download the card and add it to your post too.</p>
        </div>
      </div>
    );
  }

  const ready = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim()) && (!SITE_KEY || !!token);
  return (
    <form className="join" id={id} onSubmit={submit}>
      <div className="join-row">
        <input type="email" required autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
        <button type="submit" disabled={!ready || busy}>
          {busy ? "Joining…" : "Get early access"}
        </button>
      </div>
      {SITE_KEY && <div ref={box} className="captcha" />}
      {error ? (
        <p className="join-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="join-note">Free. One email when we open, nothing else. Not financial advice.</p>
      )}
    </form>
  );
}
