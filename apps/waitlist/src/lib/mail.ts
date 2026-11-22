import nodemailer from "nodemailer";
import type { Status } from "./members";
import { welcomeEmail } from "./welcome-email";
import { friendEmail, type FriendData } from "./friend-email";

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

/** "A friend joined with your link", to the inviter, the moment the friend's account is
 *  made (template: friend-email.ts). Skipped without SMTP. */
export async function sendFriendJoined(email: string, friend: string, s: FriendData): Promise<void> {
  const t = transport();
  if (!t) return;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const mail = friendEmail(SITE, friend, s);
  await Promise.race([
    t.sendMail({ from, to: email, subject: mail.subject, text: mail.text, html: mail.html }).catch((e) => console.error("friend email failed", e instanceof Error ? e.message : e)),
    new Promise((r) => setTimeout(r, 8_000)),
  ]);
}