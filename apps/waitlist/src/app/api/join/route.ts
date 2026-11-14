import { NextResponse } from "next/server";
import { allowed, configured, human, join } from "@/lib/waitlist";
import { sendWelcome } from "@/lib/mail";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "The waitlist is not set up yet" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; ref?: string; source?: string; token?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (ip && !allowed(ip)) return NextResponse.json({ error: "Too many tries, wait a few minutes" }, { status: 429 });
  if (!(await human(body.token ?? "", ip))) return NextResponse.json({ error: "Please complete the check and try again" }, { status: 400 });
  const ref = (body.ref ?? "").trim().toLowerCase() || null;
  const source = (body.source ?? "").trim().slice(0, 64) || null;
  try {
    const { created, ...status } = await join(email, ref, source);
    if (created) await sendWelcome(email, status);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: "Something went wrong, try again" }, { status: 500 });
  }
}
