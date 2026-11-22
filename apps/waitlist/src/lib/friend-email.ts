/* "A friend joined with your link": sent to the person whose invite link was used, in the
   same layout as the welcome email (Kixo mark, dark card, Kixo's socials, signed by the
   Kixo team). Email-client safe: tables and inline styles. */

import { nextStep, offerFor } from "./offers";
import { SOCIALS } from "./socials";

const BG = "#050506";
const CARD = "#0d0e10";
const CARD_2 = "#131417";
const LINE = "#1f2126";
const TEXT = "#ededef";
const TEXT_2 = "#a1a1aa";
const MUTED = "#6b6b74";
const EMERALD = "#2fd38a";
const CYAN = "#22d3ee";
const FONT = "Inter,Segoe UI,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type FriendData = { code: string; handle?: string | null; position: number; referrals: number; rank: number };

export function friendEmail(site: string, friend: string, s: FriendData): { subject: string; text: string; html: string } {
  const link = `${site}/?ref=${s.handle ?? s.code}`;
  const o = offerFor(s.referrals, s.rank);
  const next = nextStep(s.referrals, s.rank);
  const friends = `${s.referrals} friend${s.referrals === 1 ? "" : "s"}`;
  const subject = `New referral: ${friend} joined Kixo with your link`;
  const progress = next ? Math.round((s.referrals / (s.referrals + next.invites)) * 100) : 100;

  const text = [
    `${friend} just joined Kixo with your invite link.`,
    "",
    `You now have ${friends} and you are #${s.position.toLocaleString("en-US")} on the waitlist.`,
    `Your offer: ${o.name}, ${o.off}% off Kixo's trading fee for ${o.months} months.`,
    next ? `${next.invites} more friend${next.invites === 1 ? "" : "s"} to unlock ${next.offer.name} (${next.offer.off}% off).` : "You have the top offer.",
    "Every friend is also a ticket in the gift draw.",
    "",
    `Keep sharing: ${link}`,
    "",
    `Follow Kixo: ${SOCIALS.map((x) => `${x.name} ${x.href}`).join(" · ")}`,
    "",
    "The Kixo team",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;color:${BG}">${esc(friend)} joined with your link. You now have ${friends}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:28px 12px;background:${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td style="padding:0 4px 22px;background:${BG}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:${BG};font-family:${FONT};font-size:22px;font-weight:700;color:${TEXT}"><img src="${site}/kixo-mark.png" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px;border:0">Kixo</td>
      <td align="right" style="background:${BG};font-family:${MONO};font-size:12px;color:${EMERALD}">&#9679; New referral</td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 4px 8px;background:${BG};font-family:${FONT};font-size:26px;line-height:1.25;font-weight:700;color:${TEXT}"><span style="color:${EMERALD}">${esc(friend)}</span> joined with your link</td></tr>
  <tr><td style="padding:0 4px 20px;background:${BG};font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT_2}">Nice one. They are on the Kixo waitlist now, and they count for you.</td></tr>

  <tr><td style="padding:0 0 18px;background:${BG}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1f4a37;border-radius:16px;background:${CARD_2}">
      <tr>
        <td width="50%" style="padding:20px 22px;background:${CARD_2};border-radius:16px 0 0 16px;font-family:${FONT}"><div style="font-size:13px;color:${MUTED}">Friends who joined</div><div style="font-family:${MONO};font-size:34px;font-weight:700;color:${EMERALD};margin-top:4px">${s.referrals}</div></td>
        <td width="50%" style="padding:20px 22px;background:${CARD_2};border-radius:0 16px 16px 0;font-family:${FONT}"><div style="font-size:13px;color:${MUTED}">Your place</div><div style="font-family:${MONO};font-size:34px;font-weight:700;color:${TEXT};margin-top:4px">#${s.position.toLocaleString("en-US")}</div></td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 0 22px;background:${BG}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;background:${CARD}">
      <tr><td style="padding:16px 20px 6px;background:${CARD};border-radius:14px 14px 0 0;font-family:${FONT};font-size:15px;color:${TEXT}"><b style="color:${EMERALD}">${esc(o.name)}</b>: ${o.off}% off Kixo's trading fee for ${o.months} months</td></tr>
      <tr><td style="padding:4px 20px 8px;background:${CARD};font-family:${FONT};font-size:14px;color:${TEXT_2}">${next ? `<b style="color:${TEXT}">${next.invites} more friend${next.invites === 1 ? "" : "s"}</b> to unlock <b style="color:${TEXT}">${esc(next.offer.name)}</b>, ${next.offer.off}% off` : `<b style="color:${TEXT}">You have the top offer.</b>`}. Every friend is a ticket in the gift draw.</td></tr>
      <tr><td style="padding:4px 20px 18px;background:${CARD};border-radius:0 0 14px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c20;border-radius:4px"><tr><td style="height:6px;line-height:6px;font-size:0;background:#1a1c20;border-radius:4px"><div style="width:${progress}%;height:6px;background:${EMERALD};border-radius:4px"></div></td></tr></table></td></tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:0 0 10px;background:${BG}"><a href="${link}" style="display:inline-block;padding:13px 26px;border-radius:12px;background:${EMERALD};color:#04130c;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none">Share your link again</a></td></tr>
  <tr><td align="center" style="padding:0 0 28px;background:${BG};font-family:${MONO};font-size:13px"><a href="${link}" style="color:${CYAN};text-decoration:none">${esc(link.replace(/^https?:\/\//, ""))}</a></td></tr>

  <tr><td align="center" style="padding:0 0 10px;background:${BG};font-family:${FONT};font-size:14px;color:${TEXT_2}">Follow Kixo for the launch</td></tr>
  <tr><td align="center" style="padding:0 0 26px;background:${BG}"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
    ${SOCIALS.map((x) => `<td style="padding:0 4px;background:${BG}"><a href="${x.href}" style="display:inline-block;padding:10px 16px;border-radius:10px;border:1px solid ${LINE};background:${CARD};color:${TEXT};font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none">${x.name}</a></td>`).join("")}
  </tr></table></td></tr>

  <tr><td style="padding:18px 4px 0;border-top:1px solid ${LINE};background:${BG};font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED}">
    The Kixo team &middot; <a href="${site}" style="color:${MUTED}">${esc(site.replace(/^https?:\/\//, ""))}</a><br>
    You get this because you are on the Kixo waitlist and someone joined with your link. Not financial advice.
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
