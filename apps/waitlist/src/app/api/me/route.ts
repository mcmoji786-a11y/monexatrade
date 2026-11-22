import { NextResponse } from "next/server";
import { configured, emailOf, join, placeById, userFrom } from "@/lib/members";
import { sendFriendJoined, sendWelcome } from "@/lib/mail";

/** `POST /api/me {ref?, source?}` with the signed-in account's access token: puts the
 *  account on the list (once) and returns its place, invite code, friends and invites.
 *  The first time, the welcome email goes out; when this request names who invited the
 *  account, that person gets a "friend joined" email. */
export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "The waitlist is not set up yet" }, { status: 503 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = await userFrom(token).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ref?: string; source?: string };
  const ref = (body.ref ?? "").trim().toLowerCase() || null;
  const source = (body.source ?? "").trim().slice(0, 64) || null;
  try {
    const { created, newInviter, ...status } = await join(user, ref, source);
    const mails: Promise<unknown>[] = [];
    if (created && user.email) mails.push(sendWelcome(user.email, status).catch(() => {}));
    if (newInviter) {
      // The friend is named by first name only (or their Kixo name), never their email.
      const friend = status.handle ? `@${status.handle}` : (user.name?.split(" ")[0] ?? "A new trader");
      mails.push(
        Promise.all([emailOf(newInviter), placeById(newInviter)])
          .then(([to, place]) => (to && place ? sendFriendJoined(to, friend, place) : undefined))
          .catch(() => {}),
      );
    }
    await Promise.all(mails);
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Something went wrong, try again" }, { status: 500 });
  }
}
