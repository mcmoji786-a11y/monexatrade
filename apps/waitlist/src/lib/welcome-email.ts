/* The welcome email every new member gets: their pass as the hero (place, offer, the
   number of people on the list), what they unlocked, what the next offer takes, their
   invite link with one-tap sharing, their share card and what happens next.
   Email clients are old browsers: tables, inline styles, no web fonts relied on, dark
   colours set on every cell so Gmail's dark mode does not invert them. */

import { AI_FREE, BASE_FEE_PCT, feeAfter, nextStep, offerFor, OFFERS } from "./offers";

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

export type WelcomeData = { code: string; handle?: string | null; position: number; total: number; referrals: number; rank: number; name?: string | null };

export function welcomeEmail(site: string, s: WelcomeData): { subject: string; text: string; html: string } {
  const link = `${site}/?ref=${s.handle ?? s.code}`;
  const o = offerFor(s.referrals, s.rank);
  const next = nextStep(s.referrals, s.rank);
  const place = `#${s.position.toLocaleString("en-US")}`;
  const first = s.name?.split(" ")[0];
  const pitch = `I'm ${place} on the Kixo waitlist: the AI that trades Solana memecoins for you. Join with my link and get the AI agent free for a year`;
  const share = [
    { name: "X", href: `https://x.com/intent/post?text=${encodeURIComponent(pitch)}&url=${encodeURIComponent(link)}` },
    { name: "Telegram", href: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(pitch)}` },
    { name: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${pitch} ${link}`)}` },
  ];
  const progress = next ? Math.round((s.referrals / (s.referrals + next.invites)) * 100) : 100;
  const tierIndex = OFFERS.findIndex((x) => x.key === o.key);

  const subject = `${first ? `${first}, you're` : "You're"} ${place} on the Kixo waitlist`;

  const text = [
    `${first ? `${first}, welcome` : "Welcome"} to Kixo. You're ${place} on the waitlist.`,
    "",
    `Your pass: ${o.name}`,
    `- ${AI_FREE.title}`,
    `- ${o.off}% off Kixo's trading fee for ${o.months} months (${feeAfter(o)}% instead of ${BASE_FEE_PCT}%)${o.extra ? `, plus the ${o.extra}` : ""}`,
    next ? `\n${next.invites} more friend${next.invites === 1 ? "" : "s"} to unlock ${next.offer.name} (${next.offer.off}% off for ${next.offer.months} months).` : "\nYou have the top offer.",
    "",
    `Your invite link: ${link}`,
    `Your Kixo name: ${s.handle ? `@${s.handle}` : s.code.toUpperCase()}`,
    "Every friend who joins with it moves you up 3 places and is a ticket in the gift draw.",
    "",
    "What happens next:",
    "1. Share your link. Watch your place climb.",
    "2. We open Kixo to the list first, by email.",
    "3. Sign in the same way you did today. Your offer is already on your account.",
    "",
    "Not financial advice: memecoins are very risky and most lose value.",
    "You get this because you joined the Kixo waitlist.",
  ].join("\n");

  const tierCells = OFFERS.map((t, i) => {
    const on = i <= tierIndex;
    return `<td width="33%" style="padding:0 4px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${on ? "#1f4a37" : LINE};border-radius:10px;background:${on ? "#0f1a15" : CARD}">
        <tr><td style="padding:10px 12px;font-family:${FONT};font-size:12px;color:${on ? TEXT : MUTED};background:${on ? "#0f1a15" : CARD};border-radius:10px">${esc(t.name)}<br><span style="font-family:${MONO};font-size:12px;color:${on ? EMERALD : MUTED}">${t.off}% off</span></td></tr>
      </table></td>`;
  }).join("");

  const steps = [
    ["Share your link", "Every friend moves you up 3 places and is a ticket in the gift draw."],
    ["We open Kixo to the list first", "You hear it from us by email, before anyone else."],
    ["Sign in the same way you did today", "Your place, friends and offer are already on your account."],
  ]
    .map(
      ([t, b], i) => `<tr>
        <td width="36" valign="top" style="padding:0 12px 16px 0;background:${BG}"><div style="width:28px;height:28px;line-height:28px;text-align:center;border-radius:14px;background:#0f1a15;color:${EMERALD};font-family:${MONO};font-size:13px">${i + 1}</div></td>
        <td valign="top" style="padding:3px 0 16px;background:${BG};font-family:${FONT}"><div style="font-size:15px;color:${TEXT};font-weight:600">${t}</div><div style="font-size:14px;color:${TEXT_2};margin-top:2px">${b}</div></td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;color:${BG}">Your Kixo pass is ready: ${place}, the AI agent free for a year and your invite link inside.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:28px 12px;background:${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">

  <tr><td style="padding:0 4px 22px;background:${BG}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:${BG};font-family:${FONT};font-size:22px;font-weight:700;color:${TEXT}"><img src="${site}/kixo-mark.png" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px;border:0">Kixo</td>
      <td align="right" style="background:${BG};font-family:${MONO};font-size:12px;color:${EMERALD}">&#9679; Early access</td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 4px 8px;background:${BG};font-family:${FONT};font-size:28px;line-height:1.2;font-weight:700;color:${TEXT}">${first ? `${esc(first)}, you're in.` : "You're in."}</td></tr>
  <tr><td style="padding:0 4px 22px;background:${BG};font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT_2}">Your Kixo account is ready and your place on the waitlist is locked. Here is your pass.</td></tr>

  <tr><td style="padding:0 0 18px;background:${BG}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1f4a37;border-radius:18px;background:${CARD_2}">
      <tr><td style="padding:22px 22px 6px;background:${CARD_2};border-radius:18px 18px 0 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="background:${CARD_2};font-family:${FONT};font-size:13px;color:${MUTED}">Your place on the list</td>
          <td align="right" style="background:${CARD_2};font-family:${MONO};font-size:12px;color:${EMERALD}">${esc(o.name).toUpperCase()}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0 22px;background:${CARD_2};font-family:${MONO};font-size:64px;line-height:1.05;font-weight:700;color:${TEXT};letter-spacing:-2px"><span style="color:${EMERALD}">#</span>${s.position.toLocaleString("en-US")}</td></tr>
      <tr><td style="padding:6px 22px 18px;background:${CARD_2};font-family:${MONO};font-size:13px;color:${TEXT_2}">of ${s.total.toLocaleString("en-US")} on the list${s.handle ? ` &middot; @${esc(s.handle)}` : ""}</td></tr>
      <tr><td style="padding:0 18px 20px;background:${CARD_2};border-radius:0 0 18px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tierCells}</tr></table></td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 0 18px;background:${BG}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;background:${CARD}">
      <tr><td style="padding:18px 20px 6px;background:${CARD};border-radius:14px 14px 0 0;font-family:${FONT};font-size:13px;color:${MUTED}">Unlocked on your account</td></tr>
      <tr><td style="padding:6px 20px;background:${CARD};font-family:${FONT};font-size:15px;color:${TEXT}"><span style="color:${EMERALD}">&#10003;</span>&nbsp; ${esc(AI_FREE.title)}</td></tr>
      <tr><td style="padding:6px 20px;background:${CARD};font-family:${FONT};font-size:15px;color:${TEXT}"><span style="color:${EMERALD}">&#10003;</span>&nbsp; ${o.off}% off Kixo's trading fee for ${o.months} months <span style="color:${MUTED}">(${feeAfter(o)}% instead of ${BASE_FEE_PCT}%)</span></td></tr>
      ${o.extra ? `<tr><td style="padding:6px 20px;background:${CARD};font-family:${FONT};font-size:15px;color:${TEXT}"><span style="color:${EMERALD}">&#10003;</span>&nbsp; The ${esc(o.extra)}</td></tr>` : ""}
      <tr><td style="padding:14px 20px 18px;background:${CARD};border-radius:0 0 14px 14px">
        <div style="font-family:${FONT};font-size:14px;color:${TEXT_2};margin-bottom:8px">${next ? `<b style="color:${TEXT}">${next.invites} more friend${next.invites === 1 ? "" : "s"}</b> to unlock <b style="color:${TEXT}">${esc(next.offer.name)}</b>: ${next.offer.off}% off for ${next.offer.months} months` : `<b style="color:${TEXT}">You have the top offer.</b>`}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c20;border-radius:4px"><tr><td style="height:6px;line-height:6px;font-size:0;background:#1a1c20;border-radius:4px"><div style="width:${progress}%;height:6px;background:${EMERALD};border-radius:4px"></div></td></tr></table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:6px 4px 10px;background:${BG};font-family:${FONT};font-size:20px;font-weight:700;color:${TEXT}">Move up the list</td></tr>
  <tr><td style="padding:0 4px 14px;background:${BG};font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT_2}">Every friend who joins with your link moves you up 3 places and is a ticket in the draw for a printed Kixo T-shirt, mug or sticker pack.</td></tr>
  <tr><td style="padding:0 0 12px;background:${BG}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;background:${CARD}"><tr>
      <td style="padding:14px 16px;background:${CARD};border-radius:12px;font-family:${MONO};font-size:14px;word-break:break-all"><a href="${link}" style="color:${CYAN};text-decoration:none">${esc(link.replace(/^https?:\/\//, ""))}</a></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 0 24px;background:${BG}">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      ${share
        .map(
          (x, i) =>
            `<td style="padding-right:8px;background:${BG}"><a href="${x.href}" style="display:inline-block;padding:11px 18px;border-radius:10px;font-family:${FONT};font-size:14px;font-weight:600;text-decoration:none;${i === 0 ? `background:${EMERALD};color:#04130c` : `background:${CARD};color:${TEXT};border:1px solid ${LINE}`}">${i === 0 ? "Share on X" : x.name}</a></td>`,
        )
        .join("")}
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 0 28px;background:${BG}"><a href="${link}"><img src="${site}/api/card?code=${s.code}" width="580" alt="Your Kixo card: ${esc(place)} on the waitlist" style="display:block;width:100%;max-width:580px;height:auto;border-radius:14px;border:1px solid ${LINE}"></a></td></tr>

  <tr><td style="padding:0 4px 14px;background:${BG};font-family:${FONT};font-size:20px;font-weight:700;color:${TEXT}">What happens next</td></tr>
  <tr><td style="padding:0 4px 8px;background:${BG}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table></td></tr>

  <tr><td align="center" style="padding:8px 0 30px;background:${BG}"><a href="${site}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:${TEXT};color:${BG};font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none">Open your pass</a></td></tr>

  <tr><td style="padding:18px 4px 0;border-top:1px solid ${LINE};background:${BG};font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED}">
    Kixo is in development and opens to the waitlist first. Not financial advice: memecoins are very risky and most lose value.<br>
    You get this because you joined the Kixo waitlist at <a href="${site}" style="color:${MUTED}">${esc(site.replace(/^https?:\/\//, ""))}</a>.
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
