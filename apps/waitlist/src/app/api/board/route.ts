import { NextResponse } from "next/server";
import { board, configured } from "@/lib/members";

/** `GET /api/board`: the top 20 inviters (public handle or a shortened code, never an
 *  email), refreshed every minute. */
export async function GET() {
  if (!configured()) return NextResponse.json({ rows: [] });
  return NextResponse.json({ rows: await board(20).catch(() => []) }, { headers: { "cache-control": "public, max-age=60" } });
}
