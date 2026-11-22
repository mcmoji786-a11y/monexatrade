import nodemailer from "nodemailer";
import type { Status } from "./members";
import { nextStep, offerFor } from "./offers";
import { welcomeEmail } from "./welcome-email";

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
  const mail = welcomeEmail(SITE, s);
  await Promise.race([
    t.sendMail({ from, to: email, subject: mail.subject, text: mail.text, html: mail.html }).catch((e) => console.error("welcome email failed", e instanceof Error ? e.message : e)),
    new Promise((r) => setTimeout(r, 8_000)),
  ]);
}

/** "A friend joined with your link": who, how many friends now, the place they moved to
 *  and what the next offer needs. Sent to the inviter the moment the friend's account is
 *  made. Skipped without SMTP. */
export async function sendFriendJoined(email: string, friend: string, s: { code: string; handle?: string | null; position: number; referrals: number; rank: number }): Promise<void> {
  const t = transport();
  if (!t) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const link = `${SITE}/?ref=${s.handle ?? s.code}`;
  const o = offerFor(s.referrals, s.rank);
  const next = nextStep(s.referrals, s.rank);
  const friends = `${s.referrals} friend${s.referrals === 1 ? "" : "s"}`;
  const text = [
    `${friend} just joined Kixo with your link.`,
    "",
    `You now have ${friends} and you are #${s.position.toLocaleString("en-US")} on the waitlist.`,
    `Your offer: ${o.name}, ${o.off}% off Kixo's trading fee for ${o.months} months.`,
    next ? `${next.invites} more friend${next.invites === 1 ? "" : "s"} to unlock ${next.offer.name}.` : "You have the top offer.",
    "Every friend is also a ticket in the gift draw.",
    "",
    `Keep sharing: ${link}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#050506;font-family:Inter,Arial,sans-serif;color:#ededef">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050506"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="font-size:22px;font-weight:700;padding-bottom:24px"><img src="${SITE}/kixo-mark.png" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px">Kixo</td></tr>
<tr><td style="font-size:26px;font-weight:700;line-height:1.3"><span style="color:#2fd38a">${esc(friend)}</span> just joined with your link</td></tr>
<tr><td style="padding-top:16px;font-size:15px;color:#a1a1aa">You now have <b style="color:#ededef">${friends}</b> and you are <b style="color:#ededef">#${s.position.toLocaleString("en-US")}</b> on the waitlist.</td></tr>
<tr><td style="padding-top:16px"><div style="background:#0d0e10;border:1px solid #1f3a2e;border-radius:14px;padding:18px">
<div style="font-size:16px"><b style="color:#2fd38a">${esc(o.name)}</b>: ${o.off}% off Kixo's trading fee for ${o.months} months</div>
<div style="font-size:14px;color:#a1a1aa;margin-top:6px">${next ? `${next.invites} more friend${next.invites === 1 ? "" : "s"} to unlock <b style="color:#ededef">${esc(next.offer.name)}</b>` : "You have the top offer"}. Every friend is a ticket in the gift draw.</div>
</div></td></tr>
<tr><td style="padding-top:24px"><a href="${link}" style="display:inline-block;background:#2fd38a;color:#04130c;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">Share your link again</a></td></tr>
<tr><td style="padding-top:12px;font-family:monospace;font-size:13px;color:#22d3ee">${esc(link)}</td></tr>
<tr><td style="padding-top:32px;font-size:12px;color:#6b6b74;line-height:1.6">You get this because you are on the Kixo waitlist. Not financial advice.</td></tr>
</table></td></tr></table></body></html>`;
  await Promise.race([
    t.sendMail({ from, to: email, subject: `${friend} joined Kixo with your link`, text, html }).catch((e) => console.error("friend email failed", e instanceof Error ? e.message : e)),
    new Promise((r) => setTimeout(r, 8_000)),
  ]);
}
