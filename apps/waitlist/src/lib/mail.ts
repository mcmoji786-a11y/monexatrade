import nodemailer from "nodemailer";
import type { Status } from "./waitlist";
import { AI_FREE, feeAfter, nextStep, offerFor } from "./offers";

/* The welcome email after someone joins: their place, their offer and their invite link.
   Sent through the founder's SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
   SMTP_FROM). Skipped when SMTP is not set. Never blocks the sign-up for long. */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";

function transport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendWelcome(email: string, s: Status): Promise<void> {
  const t = transport();
  if (!t) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const link = `${SITE}/?ref=${s.code}`;
  const o = offerFor(s.referrals, s.rank);
  const next = nextStep(s.referrals, s.rank);
  const place = `#${s.position.toLocaleString("en-US")}`;
  const x = `https://x.com/intent/post?text=${encodeURIComponent(`I'm ${place} on the Kixo waitlist: the AI that trades Solana memecoins for you. Early list gets the AI free for 1 year 👇`)}&url=${encodeURIComponent(link)}`;
  const text = [
    `You're on the Kixo waitlist: ${place}`,
    "",
    `Your offer: ${AI_FREE.title} + ${o.name} (${o.off}% off Kixo's trading fee for ${o.months} months, ${feeAfter(o)}% instead of 0.5%).`,
    next ? `${next.invites} more friend${next.invites === 1 ? "" : "s"} to unlock ${next.offer.name}.` : "",
    "",
    `Your invite link: ${link}`,
    "Every friend who joins with it moves you up 3 places.",
    "",
    "We'll email you when Kixo opens. Not financial advice.",
    "You get this because you joined at kixo.trade.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#050506;font-family:Inter,Arial,sans-serif;color:#ededef">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050506"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="font-size:22px;font-weight:700;padding-bottom:24px"><img src="${SITE}/kixo-mark.png" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px">Kixo</td></tr>
<tr><td style="font-size:14px;color:#a1a1aa">You're on the waitlist</td></tr>
<tr><td style="font-size:64px;font-weight:800;letter-spacing:-2px;padding:4px 0 12px"><span style="color:#2fd38a">#</span>${esc(s.position.toLocaleString("en-US"))}</td></tr>
<tr><td style="background:#0d0e10;border:1px solid #1f3a2e;border-radius:14px;padding:18px">
<div style="font-size:16px"><b style="color:#2fd38a">${esc(AI_FREE.title)}</b> + <b style="color:#2fd38a">${esc(o.name)}</b></div>
<div style="font-size:14px;color:#a1a1aa;margin-top:6px">${o.off}% off Kixo's trading fee for ${o.months} months (${feeAfter(o)}% instead of 0.5%)${o.extra ? ` + ${esc(o.extra)}` : ""}</div>
${next ? `<div style="font-size:14px;color:#a1a1aa;margin-top:6px">${next.invites} more friend${next.invites === 1 ? "" : "s"} to unlock <b style="color:#ededef">${esc(next.offer.name)}</b>: ${next.offer.off}% off for ${next.offer.months} months</div>` : ""}
</td></tr>
<tr><td style="padding-top:24px"><img src="${SITE}/api/card?code=${s.code}" width="560" alt="Your Kixo card" style="width:100%;max-width:560px;border-radius:12px;border:1px solid #1d1e22"></td></tr>
<tr><td style="padding-top:20px;font-size:14px;color:#a1a1aa">Your invite link. Every friend who joins with it moves you up 3 places:</td></tr>
<tr><td style="padding-top:8px;font-family:monospace;font-size:14px"><a href="${link}" style="color:#22d3ee">${esc(link)}</a></td></tr>
<tr><td style="padding-top:20px"><a href="${x}" style="display:inline-block;background:#2fd38a;color:#04130c;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">Share on X</a></td></tr>
<tr><td style="padding-top:32px;font-size:12px;color:#6b6b74;line-height:1.6">We'll email you when Kixo opens. Not financial advice: memecoins are very risky.<br>You get this because you joined the waitlist at kixo.trade.</td></tr>
</table></td></tr></table></body></html>`;
  await Promise.race([
    t.sendMail({ from, to: email, subject: `You're ${place} on the Kixo waitlist`, text, html }).catch((e) => console.error("welcome email failed", e instanceof Error ? e.message : e)),
    new Promise((r) => setTimeout(r, 8_000)),
  ]);
}
