import { NextResponse } from "next/server";
import { configured, total } from "@/lib/waitlist";

/** `GET /api/count` : how many people are on the list (the page shows it from 100). */
export async function GET() {
  if (!configured()) return NextResponse.json({ total: 0 });
  return NextResponse.json({ total: await total() }, { headers: { "cache-control": "public, max-age=60" } });
}
