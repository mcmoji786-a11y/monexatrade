// Shared helpers for Kixo's end-to-end checks: read the project's .env, make a temporary
// test account (always deleted afterwards), call the gateway as that account, and count
// passes and failures. Test accounts use the mx-shot-*@example.com pattern, so
// tests/e2e/cleanup.mjs can remove any that a crash left behind.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

export const GW = process.env.KIXO_GATEWAY ?? "http://localhost:8080";
const SB = env.SUPABASE_URL;
const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };

/** A real coin with steady trading, for demo orders. */
export const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

export const results = { pass: 0, fail: 0, skip: 0 };

export function check(name, ok, extra = "") {
  if (ok) results.pass++;
  else results.fail++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${extra ? `  (${String(extra).slice(0, 160)})` : ""}`);
}

export function skip(name, why) {
  results.skip++;
  console.log(`  SKIP  ${name}  (${why})`);
}

const made = [];

/** A temporary signed-in account; returns call(path, method?, body?) -> [status, text]. */
export async function tempUser(tag) {
  const email = `mx-shot-${tag}${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
  const password = "Test-" + Math.random().toString(36).slice(2) + "A9!";
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { terms_version: 2 } }) })).json();
  if (!u.id) throw new Error(`could not make a test account: ${JSON.stringify(u).slice(0, 200)}`);
  made.push(u.id);
  const s = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  const h = { authorization: `Bearer ${s.access_token}`, "content-type": "application/json" };
  const call = async (p, method = "GET", body) => {
    const r = await fetch(GW + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return [r.status, await r.text()];
  };
  call.id = u.id;
  call.email = email;
  return call;
}

/** Deletes every account this run made. */
export async function cleanup() {
  for (const id of made.splice(0)) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
}

/** Deletes leftover test accounts from earlier runs. */
export async function cleanupLeftovers() {
  const r = await (await fetch(`${SB}/auth/v1/admin/users?per_page=1000`, { headers: admin })).json();
  const old = (r.users ?? []).filter((u) => /^mx-shot-.*@example\.com$/.test(u.email ?? ""));
  for (const u of old) await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: admin });
  return old.length;
}

export const json = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
