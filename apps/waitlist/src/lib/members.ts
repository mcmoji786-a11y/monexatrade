/* The waitlist on the server: people join with their Kixo account (Supabase auth, the
   same project as the app). Read and written only here, with the service role.

   - Their place: public.waitlist_members (migration 0019), numbered in joining order.
   - Their invite code and who invited them: public.profiles.ref_code / referred_by, the
     app's own referral fields, so links and counts carry over to the app at launch.
   Every friend who joins with someone's link moves them up REF_BOOST places. */

import { createHash } from "crypto";

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const REF_BOOST = 3;
/** A referral link counts only for an account opened within this time (as in the app). */
const CLAIM_WINDOW_MS = 24 * 3600 * 1000;

export const configured = () => !!URL_ && !!KEY;

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  return fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(init.prefer ? { prefer: init.prefer } : {}) },
    cache: "no-store",
  });
}

async function rows<T>(path: string): Promise<T[]> {
  const res = await rest(path);
  return res.ok ? ((await res.json()) as T[]) : [];
}

async function count(table: string, filter = ""): Promise<number> {
  const res = await rest(`${table}?select=${table === "profiles" ? "id" : "user_id"}${filter ? `&${filter}` : ""}`, { method: "HEAD", prefer: "count=exact" });
  return Number((res.headers.get("content-range") ?? "").split("/")[1] ?? 0) || 0;
}

/** People on the list. */
export const total = () => count("waitlist_members");

export type User = { id: string; email: string | null; createdAt: number; method: "google" | "email"; name: string | null; avatar: string | null };

/** The account behind a browser's access token, checked with Supabase. */
export async function userFrom(token: string): Promise<User | null> {
  if (!token) return null;
  const res = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return null;
  const u = (await res.json()) as { id?: string; email?: string; created_at?: string; app_metadata?: { provider?: string }; user_metadata?: { full_name?: string; name?: string; avatar_url?: string; picture?: string } };
  if (!u.id) return null;
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    createdAt: Date.parse(u.created_at ?? "") || 0,
    method: u.app_metadata?.provider === "google" ? "google" : "email",
    name: meta.full_name ?? meta.name ?? null,
    avatar: meta.avatar_url ?? meta.picture ?? null,
  };
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** The app's referral code for an account (gateway growth.rs make_code, same output). */
export function makeCode(user: string, salt: number): string {
  const h = createHash("sha256").update(`monexa-ref:${user}:${salt}`).digest();
  return Array.from(h.subarray(0, 7), (b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const validCode = (c: string) => /^[a-z0-9]{6,12}$/.test(c);

type Profile = { id: string; ref_code: string | null; referred_by: string | null };

/** The account's profile with its invite code, made on first visit. */
async function ensureProfile(u: User): Promise<Profile> {
  const found = (await rows<Profile>(`profiles?id=eq.${u.id}&select=id,ref_code,referred_by`))[0];
  if (found?.ref_code) return found;
  for (let salt = 0; salt < 5; salt++) {
    const code = makeCode(u.id, salt);
    const res = found
      ? await rest(`profiles?id=eq.${u.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ ref_code: code }) })
      : await rest("profiles?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: JSON.stringify({ id: u.id, login_method: u.method, ref_code: code }) });
    if (res.ok) return { id: u.id, ref_code: code, referred_by: found?.referred_by ?? null };
    if (res.status !== 409) throw new Error(`profile not saved (${res.status})`);
  }
  throw new Error("could not make an invite code");
}

/** The account behind an invite: its code, or its public Kixo name (with or without @),
 *  as seen in someone's share video. */
async function referrer(ref: string): Promise<string | null> {
  const r = ref.trim().toLowerCase();
  const name = r.replace(/^@/, "");
  if (!r.startsWith("@") && validCode(r)) {
    const byCode = (await rows<{ id: string }>(`profiles?ref_code=eq.${r}&select=id`))[0];
    if (byCode) return byCode.id;
  }
  if (!/^[a-z0-9_]{3,20}$/.test(name)) return null;
  const byName = (await rows<{ user_id: string }>(`trader_profiles?handle=eq.${name}&select=user_id`))[0];
  return byName?.user_id ?? null;
}

/** May this account still name who invited it: not yet, and opened within a day. */
const canName = (u: User, p: Profile) => !p.referred_by && Date.now() - u.createdAt <= CLAIM_WINDOW_MS;

/** Records who invited a new account: once, only within a day of opening it, never itself.
 *  "ok", or why not. */
async function claim(u: User, p: Profile, ref: string | null): Promise<{ result: "ok" | "none" | "unknown" | "self" | "closed"; owner?: string }> {
  if (!ref) return { result: "none" };
  if (!canName(u, p)) return { result: "closed" };
  const owner = await referrer(ref);
  if (!owner) return { result: "unknown" };
  if (owner === u.id) return { result: "self" };
  // `return=representation` tells whether this request is the one that set it.
  const res = await rest(`profiles?id=eq.${u.id}&referred_by=is.null`, { method: "PATCH", prefer: "return=representation", body: JSON.stringify({ referred_by: owner, referred_at: new Date().toISOString() }) });
  const changed = res.ok && ((await res.json()) as unknown[]).length > 0;
  return changed ? { result: "ok", owner } : { result: "closed" };
}

/** The friends who joined with someone's link, newest first: their Kixo name, or
 *  "A new trader" without one, and when. */
async function friendsOf(userId: string): Promise<{ name: string; at: string | null }[]> {
  const list = await rows<{ id: string; referred_at: string | null }>(`profiles?referred_by=eq.${userId}&select=id,referred_at&order=referred_at.desc.nullslast&limit=50`);
  if (!list.length) return [];
  const names = await rows<{ user_id: string; handle: string }>(`trader_profiles?user_id=in.(${list.map((r) => r.id).join(",")})&select=user_id,handle`);
  const by = new Map(names.map((n) => [n.user_id, n.handle]));
  return list.map((r) => ({ name: by.get(r.id) ? `@${by.get(r.id)}` : "A new trader", at: r.referred_at }));
}

/** An account's email, for telling it a friend joined (Supabase admin API). */
export async function emailOf(userId: string): Promise<string | null> {
  const res = await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` }, cache: "no-store" });
  if (!res.ok) return null;
  return ((await res.json()) as { email?: string }).email ?? null;
}

/** Someone's place, by account (for the friend-joined email). */
export async function placeById(userId: string): Promise<Place | null> {
  const p = (await rows<{ ref_code: string | null }>(`profiles?id=eq.${userId}&select=ref_code`))[0];
  return p?.ref_code ? placeOf(userId, p.ref_code) : null;
}

/** Who invited the account, as shown to it: their Kixo name, or a shortened code. */
async function invitedBy(userId: string): Promise<string | null> {
  const me = (await rows<{ referred_by: string | null }>(`profiles?id=eq.${userId}&select=referred_by`))[0];
  if (!me?.referred_by) return null;
  const [tp, p] = await Promise.all([rows<{ handle: string }>(`trader_profiles?user_id=eq.${me.referred_by}&select=handle`), rows<{ ref_code: string | null }>(`profiles?id=eq.${me.referred_by}&select=ref_code`)]);
  return tp[0]?.handle ? `@${tp[0].handle}` : `${(p[0]?.ref_code ?? "kixo").slice(0, 3)}••••`;
}

export type Status = {
  code: string;
  /** Public Kixo handle (the app's trader profile), when set. */
  handle: string | null;
  /** Joining order, 1 = first (for the early offers). */
  rank: number;
  /** Place on the list after invites moved them up. */
  position: number;
  total: number;
  referrals: number;
  joinedAt: string;
  /** Who invited them (Kixo name or short code), if anyone. */
  invitedBy: string | null;
  /** They can still enter who invited them. */
  canName: boolean;
  /** What happened to the invite sent with this request. */
  claim: "ok" | "none" | "unknown" | "self" | "closed";
  /** The friends who joined with their link, newest first. */
  friends: { name: string; at: string | null }[];
  name: string | null;
  avatar: string | null;
  email: string | null;
};

type Place = Omit<Status, "name" | "avatar" | "email" | "invitedBy" | "canName" | "claim" | "friends">;

async function placeOf(userId: string, code: string): Promise<Place | null> {
  const me = (await rows<{ number: number; joined_at: string }>(`waitlist_members?user_id=eq.${userId}&select=number,joined_at`))[0];
  if (!me) return null;
  const [rank, all, referrals, handle] = await Promise.all([
    count("waitlist_members", `number=lte.${me.number}`),
    total(),
    count("profiles", `referred_by=eq.${userId}`),
    rows<{ handle: string }>(`trader_profiles?user_id=eq.${userId}&select=handle`).then((r) => r[0]?.handle ?? null),
  ]);
  return { code, handle, rank, position: Math.max(1, rank - REF_BOOST * referrals), total: all, referrals, joinedAt: me.joined_at };
}

/** Puts the account on the list (or finds it there) and returns its place, and whether it
 *  just joined (the welcome email goes only then). */
export async function join(u: User, ref: string | null, source: string | null): Promise<Status & { created: boolean; newInviter: string | null }> {
  const p = await ensureProfile(u);
  const claimed = await claim(u, p, ref);
  const ins = await rest("waitlist_members?on_conflict=user_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: JSON.stringify({ user_id: u.id, source }) });
  if (!ins.ok) throw new Error(`waitlist insert failed (${ins.status})`);
  const created = ((await ins.json()) as unknown[]).length > 0;
  const [place, by, friends] = await Promise.all([placeOf(u.id, p.ref_code!), invitedBy(u.id), friendsOf(u.id)]);
  if (!place) throw new Error("waitlist place missing");
  return {
    ...place,
    invitedBy: by,
    canName: !by && Date.now() - u.createdAt <= CLAIM_WINDOW_MS,
    claim: claimed.result,
    friends,
    name: u.name,
    avatar: u.avatar,
    email: u.email,
    created,
    newInviter: claimed.owner ?? null,
  };
}

export const validHandle = (h: string) => /^[a-z0-9_]{3,20}$/.test(h);

/** Sets the account's public Kixo handle (the app's trader profile, so it carries over).
 *  "taken" when someone else has it. */
export async function setHandle(u: User, handle: string): Promise<"ok" | "taken" | "invalid"> {
  if (!validHandle(handle)) return "invalid";
  const res = await rest("trader_profiles?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({ user_id: u.id, handle, display_name: (u.name ?? "").slice(0, 40), updated_at: new Date().toISOString() }),
  });
  if (res.ok) return "ok";
  if (res.status === 409) return "taken";
  throw new Error(`handle not saved (${res.status})`);
}

export type BoardRow = { name: string; referrals: number };

/** The top inviters: public handle, or a shortened invite code without one. */
export async function board(limit = 20): Promise<BoardRow[]> {
  const res = await rest("rpc/waitlist_board", { method: "POST", body: JSON.stringify({ p_limit: limit }) });
  if (!res.ok) return [];
  const list = (await res.json()) as { handle: string | null; code: string | null; referrals: number }[];
  return list.map((r) => ({ name: r.handle ? `@${r.handle}` : `${(r.code ?? "kixo").slice(0, 3)}••••`, referrals: Number(r.referrals) }));
}

/** A person's public place by invite code, for their share card. */
export async function byCode(code: string): Promise<Place | null> {
  if (!validCode(code)) return null;
  const owner = (await rows<{ id: string }>(`profiles?ref_code=eq.${code}&select=id`))[0];
  return owner ? placeOf(owner.id, code) : null;
}
