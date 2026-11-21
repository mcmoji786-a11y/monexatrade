import { NextResponse } from "next/server";
import { configured, join, userFrom } from "@/lib/members";
import { sendWelcome } from "@/lib/mail";

/** `POST /api/me {ref?, source?}` with the signed-in account's access token: puts the
 *  account on the list (once) and returns its place, invite code and invites. The first
 *  time, the referral it arrived with is recorded and the welcome email goes out. */
export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "The waitlist is not set up yet" }, { status: 503 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = await userFrom(token).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ref?: string; source?: string };
  const ref = (body.ref ?? "").trim().toLowerCase() || null;
  const source = (body.source ?? "").trim().slice(0, 64) || null;
  try {
    const { created, ...status } = await join(user, ref, source);
    if (created && user.email) await sendWelcome(user.email, status).catch(() => {});
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Something went wrong, try again" }, { status: 500 });
  }
}
