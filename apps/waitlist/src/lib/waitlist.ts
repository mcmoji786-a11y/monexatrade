/* The waitlist in Supabase (table public.waitlist, migration 0010), read and written
   only here with the service role. Each person gets a referral code; every friend who
   joins with it moves them up REF_BOOST places. */

const URL_ = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const REF_BOOST = 3;

export const configured = () => !!URL_ && !!KEY;

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(init.prefer ? { prefer: init.prefer } : {}) },
    cache: "no-store",
  });
  return res;
}

async function count(filter: string): Promise<number> {
  const res = await rest(`waitlist?select=id${filter ? `&${filter}` : ""}`, { method: "HEAD", prefer: "count=exact" });
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? 0) || 0;
}

/** People on the list. */
export const total = () => count("");

type Row = { id: number; code: string };

export type Status = { code: string; position: number; total: number; referrals: number };

async function status(row: Row): Promise<Status> {
  const [ahead, total, referrals] = await Promise.all([count(`id=lt.${row.id}`), count(""), count(`referred_by=eq.${row.code}`)]);
  return { code: row.code, position: Math.max(1, ahead + 1 - REF_BOOST * referrals), total, referrals };
}

export async function byCode(code: string): Promise<Status | null> {
  if (!/^[a-z0-9]{6,12}$/.test(code)) return null;
  const res = await rest(`waitlist?select=id,code&code=eq.${code}&limit=1`);
  const rows = res.ok ? ((await res.json()) as Row[]) : [];
  return rows[0] ? status(rows[0]) : null;
}

const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

/** Adds an email (or finds it again) and returns its place on the list. */
export async function join(email: string, ref: string | null, source: string | null): Promise<Status> {
  const found = await rest(`waitlist?select=id,code&email=eq.${encodeURIComponent(email)}&limit=1`);
  const existing = found.ok ? ((await found.json()) as Row[]) : [];
  if (existing[0]) return status(existing[0]);
  // A referral code counts only when it belongs to someone on the list.
  const referrer = ref && (await byCode(ref)) ? ref : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await rest("waitlist?select=id,code", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({ email, code: newCode(), referred_by: referrer, source }),
    });
    if (res.ok) return status(((await res.json()) as Row[])[0]);
    if (res.status === 409) {
      // Same email at the same moment, or (rarely) a code clash: look again.
      const again = await rest(`waitlist?select=id,code&email=eq.${encodeURIComponent(email)}&limit=1`);
      const rows = again.ok ? ((await again.json()) as Row[]) : [];
      if (rows[0]) return status(rows[0]);
      continue;
    }
    throw new Error(`waitlist insert failed (${res.status})`);
  }
  throw new Error("waitlist insert failed");
}

/** Cloudflare Turnstile check. Passes when no secret is set (local testing). */
export async function human(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }).catch(() => null);
  const v = res?.ok ? ((await res.json()) as { success?: boolean }) : null;
  return v?.success === true;
}

/* A few sign-ups per address per 10 minutes (per server instance). */
const recent = new Map<string, number[]>();
export function allowed(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (list.length >= 5) return false;
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 10_000) recent.clear();
  return true;
}
