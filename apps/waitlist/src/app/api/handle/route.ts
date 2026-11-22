import { NextResponse } from "next/server";
import { configured, setHandle, userFrom } from "@/lib/members";

/** `POST /api/handle {handle}`: the signed-in account's public Kixo handle, shown on the
 *  leaderboard and in its share video, and kept as its trader name in the app. */
export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "The waitlist is not set up yet" }, { status: 503 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = await userFrom(token).catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { handle?: string };
  const handle = (body.handle ?? "").trim().replace(/^@/, "").toLowerCase();
  try {
    const r = await setHandle(user, handle);
    if (r === "invalid") return NextResponse.json({ error: "3 to 20 letters, numbers or _" }, { status: 400 });
    if (r === "taken") return NextResponse.json({ error: "That name is taken" }, { status: 409 });
    return NextResponse.json({ handle });
  } catch {
    return NextResponse.json({ error: "Something went wrong, try again" }, { status: 500 });
  }
}
