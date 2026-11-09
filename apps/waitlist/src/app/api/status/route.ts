import { NextResponse } from "next/server";
import { byCode, configured } from "@/lib/waitlist";

/** `GET /api/status?code=` : a person's place on the list (their own code only). */
export async function GET(req: Request) {
  if (!configured()) return NextResponse.json({ error: "not set up" }, { status: 503 });
  const code = new URL(req.url).searchParams.get("code")?.trim().toLowerCase() ?? "";
  const s = await byCode(code);
  return s ? NextResponse.json(s) : NextResponse.json({ error: "not found" }, { status: 404 });
}
