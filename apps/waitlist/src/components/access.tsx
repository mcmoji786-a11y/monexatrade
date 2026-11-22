"use client";
/* The hero's live part. Signed out: Continue with Google, or an email code, which makes the
   person's Kixo account (the same one the app signs in to after launch). Signed in: their
   early-access pass with their place, offer, invites and invite link. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { callbackUrl, rememberRef, savedRef, setRef, supabase } from "@/lib/supabase";
import { AI_FREE, BASE_FEE_PCT, feeAfter, nextStep, offerFor, OFFERS } from "@/lib/offers";
import { VideoMaker } from "./video-maker";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "";
const TURNSTILE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type Claim = "ok" | "none" | "unknown" | "self" | "closed";
type Status = { invitedBy: string | null; canName: boolean; claim: Claim; code: string; handle: string | null; rank: number; position: number; total: number; referrals: number; joinedAt: string; name: string | null; avatar: string | null; email: string | null };

/* ---------------- Turnstile (only when the site key is set) ---------------- */

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

/* ---------------- Session and status ---------------- */

function useSession() {
  const [state, setState] = useState<{ ready: boolean; session: Session | null }>({ ready: false, session: null });
  useEffect(() => {
    rememberRef();
    const sb = supabase();
    if (!sb) {
      setState({ ready: true, session: null });
      return;
    }
    sb.auth.getSession().then(({ data }) => setState({ ready: true, session: data.session }));
    const { data } = sb.auth.onAuthStateChange((_e, session) => setState({ ready: true, session }));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

function useStatus(session: Session | null) {
  const [s, setS] = useState<{ token: string; status: Status | null; error: string | null }>({ token: "", status: null, error: null });
  const token = session?.access_token ?? "";
  const load = useCallback(async () => {
    if (!token) return;
    const { ref, source } = savedRef();
    try {
      const res = await fetch("/api/me", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ref, source }) });
      const v = (await res.json()) as Status & { error?: string };
      // An invite is sent once: whatever came of it, it is not sent again.
      if (res.ok && v.claim !== "none") setRef("");
      setS({ token, status: res.ok ? v : null, error: res.ok ? null : (v.error ?? "Could not load your pass") });
    } catch {
      setS({ token, status: null, error: "Could not load your pass, check your connection" });
    }
  }, [token]);
  useEffect(() => {
    if (!token) return;
    void load();
    // Invites land while the page is open: the count follows every minute.
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [token, load]);
  const view = s.token === token ? s : { token, status: null, error: null };
  return { ...view, reload: load };
}

/* ---------------- The hero block ---------------- */

export function Access() {
  const { ready, session } = useSession();
  const { status, error, reload } = useStatus(session);
  const signedIn = !!session;
  return (
    <div className="access" id="join">
      <div className="access-act">
        {!ready ? (
          <div className="panel panel-wait" aria-busy="true" />
        ) : !signedIn ? (
          <SignIn />
        ) : status ? (
          <Invite s={status} token={session.access_token} onChange={reload} />
        ) : (
          <div className="panel">
            <p className="panel-title">{error ? "Your pass did not load" : "Getting your pass"}</p>
            {error && <p className="note bad">{error}</p>}
          </div>
        )}
      </div>
      <div
        className="access-pass"
        id="pass"
        onPointerMove={(e) => {
          // The pass leans toward the pointer, like a card turned in the hand.
          const r = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          e.currentTarget.style.setProperty("--ry", `${(x * 14).toFixed(2)}deg`);
          e.currentTarget.style.setProperty("--rx", `${(-y * 10).toFixed(2)}deg`);
          e.currentTarget.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.setProperty("--ry", "0deg");
          e.currentTarget.style.setProperty("--rx", "0deg");
        }}
      >
        <Pass s={status} />
      </div>
    </div>
  );
}

/* ---------------- Sign in ---------------- */

function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"start" | "code">("start");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signin") === "failed" ? { bad: true, text: "Sign-in did not finish. Try again" } : null,
  );
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef("");

  useEffect(() => {
    if (!TURNSTILE_KEY || step !== "start") return;
    let gone = false;
    loadTurnstile().then((api) => {
      if (gone || !api || !box.current || widget.current) return;
      widget.current = api.render(box.current, { sitekey: TURNSTILE_KEY, theme: "dark", size: "flexible", callback: (t: string) => (token.current = t) });
    });
    return () => {
      gone = true;
    };
  }, [step]);

  const google = async () => {
    const sb = supabase();
    if (!sb) return setMsg({ bad: true, text: "Sign-in is not set up yet" });
    setBusy(true);
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
    if (error) {
      setBusy(false);
      setMsg({ bad: true, text: error.message });
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    const to = email.trim().toLowerCase();
    if (!sb) return setMsg({ bad: true, text: "Sign-in is not set up yet" });
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) return setMsg({ bad: true, text: "Enter a valid email address" });
    if (TURNSTILE_KEY && !token.current) return setMsg({ bad: true, text: "Complete the check first" });
    setBusy(true);
    const { error } = await sb.auth.signInWithOtp({ email: to, options: { shouldCreateUser: true, emailRedirectTo: callbackUrl(), ...(token.current ? { captchaToken: token.current } : {}) } });
    setBusy(false);
    if (error) {
      setMsg({ bad: true, text: /rate|seconds/i.test(error.message) ? "Too many tries, wait a minute and send again" : error.message });
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
      token.current = "";
      return;
    }
    setStep("code");
    setMsg({ bad: false, text: `We sent a code to ${to}. It can take a minute; check spam too` });
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setMsg({ bad: true, text: "That code did not work. Check it, or send a new one" });
  };

  return (
    <div className="panel">
      <p className="panel-title">Claim your early-access pass</p>
      <p className="panel-sub">Your Kixo account opens now. On launch day, sign in the same way and everything is waiting</p>
      {step === "start" ? (
        <>
          <InvitedBy />
          <button type="button" className="btn-google" onClick={google} disabled={busy}>
            <GoogleMark />
            Continue with Google
          </button>
          <div className="or">
            <span>or with email</span>
          </div>
          <form className="email-row" onSubmit={send}>
            <input type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="btn-ghost" disabled={busy}>
              Send code
            </button>
          </form>
          {TURNSTILE_KEY && <div ref={box} className="turnstile" />}
        </>
      ) : (
        <form className="email-row" onSubmit={verify}>
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="Code from the email" aria-label="Code from the email" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))} autoFocus />
          <button type="submit" className="btn-primary" disabled={busy || code.length < 6}>
            Verify
          </button>
        </form>
      )}
      {msg && <p className={`note ${msg.bad ? "bad" : ""}`}>{msg.text}</p>}
      {step === "code" && (
        <button type="button" className="link" onClick={() => (setStep("start"), setCode(""), setMsg(null))}>
          Use another email
        </button>
      )}
    </div>
  );
}

/** Who sent them: filled from their invite link, or typed in from a video they saw (a
 *  code, or the @name shown in it). Kept until the account is made, then sent once. */
function InvitedBy() {
  const [v, setV] = useState(() => savedRef().ref ?? "");
  const [fromLink] = useState(() => !!savedRef().ref);
  return (
    <label className="invited">
      <span>{fromLink ? "Invited by" : "Invited by someone? Optional"}</span>
      <input
        value={v}
        onChange={(e) => {
          const next = e.target.value.toLowerCase().replace(/[^a-z0-9_@]/g, "").slice(0, 21);
          setV(next);
          setRef(next);
        }}
        placeholder="Their code or @name"
        autoComplete="off"
        aria-label="Invite code or name"
      />
    </label>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/* ---------------- Signed in: invite tools ---------------- */

export function Invite({ s, token, onChange }: { s: Status; token?: string; onChange?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [video, setVideo] = useState(false);
  const link = `${SITE || window.location.origin}/?ref=${s.code}`;
  const next = nextStep(s.referrals, s.rank);
  const pitch = `I'm #${s.position.toLocaleString("en-US")} on the Kixo waitlist: the AI that trades Solana memecoins for you. Early list gets the AI agent free for a year`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const share = [
    { name: "X", href: `https://x.com/intent/post?text=${encodeURIComponent(pitch)}&url=${encodeURIComponent(link)}` },
    { name: "Telegram", href: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(pitch)}` },
    { name: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${pitch} ${link}`)}` },
  ];
  const signOut = async () => {
    await supabase()?.auth.signOut();
  };
  return (
    <div className="panel">
      <p className="panel-title">You&apos;re in{s.name ? `, ${s.name.split(" ")[0]}` : ""}</p>
      <p className="panel-sub">Every friend who joins with your link moves you up {3} places and counts toward your next offer</p>

      <div className="progress">
        <div className="progress-head">
          <span>{s.referrals.toLocaleString("en-US")} friend{s.referrals === 1 ? "" : "s"} joined</span>
          <span className="muted">{next ? `${next.invites} more for ${next.offer.name}` : "Top offer reached"}</span>
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={next ? s.referrals + next.invites : 1} aria-valuenow={next ? s.referrals : 1}>
          <i style={{ width: `${next ? Math.min(100, (s.referrals / (s.referrals + next.invites)) * 100) : 100}%` }} />
        </div>
      </div>

      <label className="field-label" htmlFor="invite-link">
        Your invite link
      </label>
      <div className="link-row">
        <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-primary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="share">
        {share.map((x) => (
          <a key={x.name} href={x.href} target="_blank" rel="noopener noreferrer" className="btn-ghost">
            {x.name}
          </a>
        ))}
        <a href={`/api/card?code=${s.code}`} target="_blank" rel="noopener" className="btn-ghost">
          Card image
        </a>
      </div>
      {s.invitedBy ? (
        <p className="note">
          Invited by <b className="accent">{s.invitedBy}</b>
        </p>
      ) : s.canName ? (
        <NameInviter last={s.claim} onDone={onChange} />
      ) : null}
      <HandleField handle={s.handle} token={token} onSaved={onChange} />
      <button type="button" className="btn-video" onClick={() => setVideo(true)}>
        <span className="live" aria-hidden="true" />
        <span>
          Make my share video
          <small>A 9 second edit with your name and link</small>
        </span>
      </button>
      {video && <VideoMaker info={{ name: s.handle ? `@${s.handle}` : (s.name?.split(" ")[0] ?? "a new trader"), handle: s.handle ? `@${s.handle}` : null, code: s.code, position: s.position, tier: offerFor(s.referrals, s.rank).name, link }} onClose={() => setVideo(false)} />}
      <p className="note">
        Signed in as {s.email ?? "your account"} ·{" "}
        <button type="button" className="link" onClick={signOut}>
          Sign out
        </button>
      </p>
    </div>
  );
}

/** After sign-in, for someone who came on their own: name who sent them (code or @name),
 *  within a day of opening the account. */
function NameInviter({ last, onDone }: { last: Claim; onDone?: () => void }) {
  const [v, setV] = useState("");
  const [sent, setSent] = useState(false);
  const why: Partial<Record<Claim, string>> = { unknown: "No one has that code or name. Check it and try again", self: "That is your own code", closed: "An invite can only be added in the first day" };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.trim()) return;
    setRef(v);
    setSent(true);
    onDone?.();
  };
  return (
    <form className="handle" onSubmit={submit}>
      <label className="field-label" htmlFor="inviter">
        Invited by someone? Enter their code or @name
      </label>
      <div className="link-row">
        <input id="inviter" value={v} onChange={(e) => (setV(e.target.value.toLowerCase().replace(/[^a-z0-9_@]/g, "").slice(0, 21)), setSent(false))} placeholder="k7pxq2m or @name" autoComplete="off" />
        <button type="submit" className="btn-ghost" disabled={!v.trim()}>
          Add
        </button>
      </div>
      {sent && why[last] && <p className="note bad">{why[last]}</p>}
    </form>
  );
}

/** The public Kixo name: on the leaderboard, in the video, and the trader name in the app. */
function HandleField({ handle, token, onSaved }: { handle: string | null; token?: string; onSaved?: () => void }) {
  const [v, setV] = useState(handle ?? "");
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = v.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(h)) return setMsg({ bad: true, text: "3 to 20 letters, numbers or _" });
    setBusy(true);
    try {
      const res = await fetch("/api/handle", { method: "POST", headers: { authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" }, body: JSON.stringify({ handle: h }) });
      const r = (await res.json()) as { error?: string };
      setMsg(res.ok ? { bad: false, text: "Saved" } : { bad: true, text: r.error ?? "Not saved" });
      if (res.ok) onSaved?.();
    } catch {
      setMsg({ bad: true, text: "Not saved, check your connection" });
    }
    setBusy(false);
  };
  return (
    <form className="handle" onSubmit={save}>
      <label className="field-label" htmlFor="handle">
        Your Kixo name{handle ? "" : ", for the leaderboard and your video"}
      </label>
      <div className="link-row">
        <span className="at">@</span>
        <input id="handle" value={v} onChange={(e) => setV(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))} placeholder="yourname" autoComplete="off" />
        <button type="submit" className="btn-ghost" disabled={busy || v === (handle ?? "")}>
          Save
        </button>
      </div>
      {msg && <p className={`note ${msg.bad ? "bad" : ""}`}>{msg.text}</p>}
    </form>
  );
}

/* ---------------- The pass ---------------- */

/** A black card with the holder's place and offer. Before sign-in it is unclaimed. */
export function Pass({ s }: { s: Status | null }) {
  const offer = s ? offerFor(s.referrals, s.rank) : null;
  const tierIndex = offer ? OFFERS.findIndex((o) => o.key === offer.key) : -1;
  return (
    <figure className={`pass ${s ? "claimed" : ""}`} aria-label={s ? `Your pass: number ${s.position}` : "Early-access pass, unclaimed"}>
      <div className="pass-top">
        <span className="pass-brand">
          <img src="/kixo-mark.png" alt="" width={22} height={22} />
          Kixo
        </span>
        <span className="pass-kind">Early access</span>
      </div>

      <div className="pass-number">
        <span className="pass-label">{s ? "Your place" : "Your place on the list"}</span>
        <span className="pass-n">
          <i>#</i>
          {s ? s.position.toLocaleString("en-US") : <span className="blank">0000</span>}
        </span>
        <span className="pass-of">{s ? `of ${s.total.toLocaleString("en-US")} · joined ${s.rank.toLocaleString("en-US")}${ordinal(s.rank)}` : "Claimed when you sign in"}</span>
      </div>

      <ol className="pass-tiers" aria-label="Offers">
        {OFFERS.map((o, i) => (
          <li key={o.key} className={i <= tierIndex ? "on" : ""}>
            <span>{o.name}</span>
            <b>{o.off}% off</b>
          </li>
        ))}
      </ol>

      <div className="pass-foot">
        <div>
          <span className="pass-label">Holder</span>
          <span className="pass-holder">{s ? (s.name ?? maskEmail(s.email)) : "Unclaimed"}</span>
        </div>
        <div className="right">
          <span className="pass-label">Included</span>
          <span className="pass-holder">{offer ? `AI agent 1 yr · fee ${feeAfter(offer)}%` : `AI agent 1 yr · fee from ${BASE_FEE_PCT}%`}</span>
        </div>
      </div>
      <figcaption className="sr-only">{AI_FREE.title}</figcaption>
    </figure>
  );
}

function ordinal(n: number) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

function maskEmail(e: string | null) {
  if (!e) return "Kixo member";
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, u.length - 2)))}@${d}`;
}
