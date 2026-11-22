/* Light protection for the waitlist's API on a single server: a per-address limit (calls
   a minute) and a small memory cache for the images it draws, so nobody can keep the
   server busy by asking for the same or endless memes. */

const hits = new Map<string, number[]>();

/** The visitor's address: Cloudflare's header first (the site sits behind its tunnel). */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** True while this address stays under `max` calls to `bucket` in the last minute. */
export function allow(req: Request, bucket: string, max: number): boolean {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20_000) hits.clear();
  return true;
}

const images = new Map<string, { at: number; body: ArrayBuffer; type: string }>();
const IMAGE_TTL = 10 * 60_000;

/** A drawn image from the last 10 minutes, or draws it and keeps it. */
export async function cachedImage(key: string, draw: () => Promise<Response>): Promise<Response> {
  const hit = images.get(key);
  if (hit && Date.now() - hit.at < IMAGE_TTL) {
    return new Response(hit.body.slice(0), { headers: { "content-type": hit.type, "cache-control": "public, max-age=600" } });
  }
  const res = await draw();
  if (!res.ok) return res;
  const body = await res.arrayBuffer();
  const type = res.headers.get("content-type") ?? "image/png";
  if (images.size > 300) {
    // Drop the oldest third.
    [...images.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100).forEach(([k]) => images.delete(k));
  }
  images.set(key, { at: Date.now(), body, type });
  return new Response(body.slice(0), { headers: { "content-type": type, "cache-control": "public, max-age=600" } });
}

export const tooMany = () => new Response(JSON.stringify({ error: "Too many tries, wait a minute" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } });
