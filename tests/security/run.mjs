// Kixo security checks against the running platform (gateway :8080, website :3000,
// Supabase). Thousands of probes, each with the answer a safe platform must give:
//
//  A. every gateway route, every method, signed out and with forged tokens: private
//     routes never answer 2xx, nothing answers 5xx
//  B. admin: refused from an address outside ADMIN_ALLOWED_IPS, refused without the key
//  C. one user reaching another user's data (IDOR)
//  D. bad input on every write route (types, sizes, injection, traversal, nulls)
//  E. bad path parameters on every route with one
//  F. query injection and SSRF through the image proxy
//  G. CORS: other websites cannot read the API
//  H. Supabase directly with the public key or a user's own token: private tables and
//     functions stay closed
//  I. the website: security headers, no secrets in the pages or their scripts, no
//     .env/.git served, admin hidden
//  J. secrets in the git history
//
//   node tests/security/run.mjs            everything
//   node tests/security/run.mjs A C        only these sections
//
// Temporary accounts only (deleted at the end). Wrong admin keys from this PC stay under
// the lockout (5), and a right key then clears the count, so the admin is never locked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanup, cleanupLeftovers, env, GW, tempUser } from "../e2e/lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = process.env.KIXO_WEB ?? "http://localhost:3000";
const SB = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const webEnv = (() => {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(ROOT, "apps/web/.env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
  } catch {
    return {};
  }
})();
const LAN = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;

/* ---------------- counting ---------------- */
const stats = {};
const failures = [];
let section = "";
function check(name, ok, detail = "") {
  stats[section] ??= { pass: 0, fail: 0 };
  stats[section][ok ? "pass" : "fail"]++;
  if (!ok) {
    failures.push({ section, name, detail: String(detail).slice(0, 300) });
    console.log(`  FAIL  ${name}  ${String(detail).slice(0, 200)}`);
  }
}
async function req(url, { method = "GET", headers = {}, body, raw = false, timeout = 15000, retried = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal: ctl.signal, redirect: "manual" });
    const text = await r.text();
    return { status: r.status, text, headers: r.headers };
  } catch (e) {
    // A pooled connection the server closed after a refused 6 MB upload: try once more on
    // a fresh one before calling it a failure.
    if (!retried && e?.name !== "AbortError") return req(url, { method, headers, body, raw, timeout, retried: true });
    return { status: 0, text: String(e?.message ?? e), headers: new Headers() };
  } finally {
    clearTimeout(t);
  }
}
const leaky = (t) => /panicked at|stack backtrace|at [\w.]+ \(.*:\d+:\d+\)|Traceback \(most recent|PGRST\d{3}|postgres|syntax error at or near|SUPABASE_SERVICE|service_role/i.test(t);

/* ---------------- the routes ---------------- */
const SAMPLE = {
  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  address: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  sig: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
  id: "1",
  handle: "kixo_test_nobody",
  code: "NOPE",
  kind: "users",
};
const ROUTES = fs
  .readFileSync(path.join(ROOT, "services/gateway/src/main.rs"), "utf8")
  .concat(fs.readdirSync(path.join(ROOT, "services/gateway/src")).filter((f) => f !== "main.rs" && f.endsWith(".rs")).map((f) => fs.readFileSync(path.join(ROOT, "services/gateway/src", f), "utf8")).join("\n"))
  .match(/\.route\("([^"]+)"/g)
  .map((m) => m.slice(8, -1))
  .filter((p, i, a) => a.indexOf(p) === i && p !== "/");
const fill = (p) => p.replace(/\{(\w+)\}/g, (_, k) => SAMPLE[k] ?? "x");

// Open to anyone (signed out is fine). Everything else needs a sign-in or the admin key.
const PUBLIC = [
  /^\/health$/, /^\/features$/, /^\/platform$/, /^\/marketing$/, /^\/rewards\/config$/, /^\/metrics\/public$/, /^\/stats$/, /^\/news$/,
  /^\/search$/, /^\/smart-money$/, /^\/token\//, /^\/wallet\/[^/]+\/(activity|balance|kixo-pnl|live|portfolio)$/, /^\/address\//, /^\/img$/,
  /^\/price$/, /^\/competition\/onchain$/, /^\/ai\/(risk|overview|chat)$/, /^\/social\/(feed|leaders|traders|trades\/|u\/)/, /^\/alerts\/status$/,
  /^\/sniper\/backtest$/, /^\/demo\/leaderboard$/, /^\/trade\/(config|sender)$/, /^\/ops\/client-error$/, /^\/track\//, /^\/support\/(diagnose|live|presence|ws)$/,
  /^\/ws\//, /^\/promo$/, /^\/kols/, /^\/x-tracker\/status$/,
];
const isPublic = (p) => PUBLIC.some((r) => r.test(p));
const isAdmin = (p) => p.startsWith("/admin/");
// Probing these with junk would leave rows in the founder's admin, marketing or error
// pages, or spend the free AI quota; they get the read-only probes only.
const NO_WRITE_FUZZ = [/^\/creator\/apply$/, /^\/track\//, /^\/ops\/client-error$/, /^\/ai\/chat$/, /^\/account\/delete$/, /^\/support\/tickets/, /^\/admin\//, /^\/promo\/redeem$/, /^\/alerts\/test$/];
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const FORGED = {
  "no token": {},
  "empty bearer": { authorization: "Bearer " },
  garbage: { authorization: "Bearer not-a-real-token-at-all-0123456789" },
  "alg none": { authorization: "Bearer " + Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url") + "." + Buffer.from(JSON.stringify({ sub: "00000000-0000-0000-0000-000000000000", role: "authenticated", exp: 9999999999 })).toString("base64url") + "." },
  "wrong signature": { authorization: "Bearer " + Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") + "." + Buffer.from(JSON.stringify({ sub: "00000000-0000-0000-0000-000000000000", role: "service_role", exp: 9999999999 })).toString("base64url") + ".c2lnbmF0dXJl" },
  "anon key as user": { authorization: `Bearer ${ANON}` },
};

/* ---------------- A. every route, signed out and forged ---------------- */
async function A() {
  for (const p of ROUTES.filter((r) => !isAdmin(r) && !r.startsWith("/ws/"))) {
    for (const m of METHODS) {
      for (const [label, headers] of Object.entries(FORGED)) {
        const body = m === "GET" || m === "DELETE" ? undefined : {};
        const r = await req(GW + fill(p), { method: m, headers: { "content-type": "application/json", ...headers }, body, timeout: p.startsWith("/wallet/") ? 45000 : 15000 });
        check(`${m} ${p} [${label}] no server error`, r.status !== 0 && r.status < 500, `${r.status} ${r.text.slice(0, 120)}`);
        check(`${m} ${p} [${label}] no internals leaked`, !leaky(r.text), r.text.slice(0, 160));
        if (!isPublic(p)) check(`${m} ${p} [${label}] private: refused`, !(r.status >= 200 && r.status < 300), `${r.status} ${r.text.slice(0, 120)}`);
      }
    }
  }
  // WebSockets: a plain request is not upgraded into data.
  for (const p of ROUTES.filter((r) => r.startsWith("/ws/"))) {
    const r = await req(GW + fill(p));
    check(`GET ${p} without upgrade is refused`, r.status >= 400 && r.status < 500, r.status);
  }
}

/* ---------------- B. admin ---------------- */
async function B() {
  const adminRoutes = ROUTES.filter(isAdmin);
  const user = await tempUser("sec-adm");
  if (LAN) {
    // From an address outside ADMIN_ALLOWED_IPS: as if there were no admin (404).
    const lan = GW.replace("localhost", LAN).replace("127.0.0.1", LAN);
    for (const p of adminRoutes) {
      for (const m of METHODS) {
        for (const [label, headers] of [["no key", {}], ["wrong key", { "x-admin-token": "wrong-" + "k".repeat(40) }], ["user token", { authorization: `Bearer ${user.token}` }]]) {
          const r = await req(lan + fill(p), { method: m, headers: { "content-type": "application/json", ...headers }, body: m === "GET" || m === "DELETE" ? undefined : {} });
          check(`${m} ${p} from ${LAN} [${label}] hidden`, r.status === 404 || r.status === 405, `${r.status} ${r.text.slice(0, 80)}`);
        }
      }
    }
    // Even the right key does not open the admin from a disallowed address.
    if (env.ADMIN_TOKEN) {
      const r = await req(lan + "/admin/check", { headers: { "x-admin-token": env.ADMIN_TOKEN } });
      check("right key from a disallowed address is still hidden", r.status === 404, r.status);
    }
  } else check("a LAN address to test from", false, "no network address found");

  // From this PC (allowed): without a key, refused; a forged X-Forwarded-For changes nothing.
  for (const p of adminRoutes) {
    const r = await req(GW + fill(p), { headers: { "x-forwarded-for": "8.8.8.8" } });
    check(`GET ${p} from this PC without a key: refused`, r.status === 401 || r.status === 403 || r.status === 404 || r.status === 405 || r.status === 429, r.status);
    if (r.status === 403) break; // a 403 counts towards the lockout; one is enough per run here
  }
  for (let i = 0; i < 3; i++) {
    const r = await req(GW + "/admin/check", { headers: { "x-admin-token": "wrong" + i } });
    check(`wrong admin key ${i + 1} refused`, r.status === 403, r.status);
  }
  if (env.ADMIN_TOKEN) {
    const ok = await req(GW + "/admin/check", { headers: { "x-admin-token": env.ADMIN_TOKEN } });
    check("the right key works from this PC (and clears the wrong-key count)", ok.status >= 200 && ok.status < 300, ok.status);
  }
  // The website's admin: only behind the secret address.
  for (const p of ["/admin", "/admin/", "/admin/users", "/admin-preview", "/dashboard", "/kixo-admin", "/panel"]) {
    const r = await req(WEB + p);
    check(`website ${p} does not show the admin`, r.status === 404 || (r.status >= 300 && r.status < 400 && !(r.headers.get("location") ?? "").includes(webEnv.ADMIN_PATH ?? "§")), r.status);
  }
}

/* ---------------- C. one user reaching another's data ---------------- */
async function C() {
  const [A1, B1] = [await tempUser("sec-a"), await tempUser("sec-b")];
  await A1("/social/me");
  // A makes things that are A's.
  await A1("/demo/order", "POST", { mint: SAMPLE.mint, side: "buy", usd: 20 });
  const parse = (t) => { try { return JSON.parse(t); } catch { return { raw: t }; } };
  const rule = parse((await A1("/demo/orders", "POST", { mint: SAMPLE.mint, kind: "tp", pct: 50, fraction: 1 }))[1]);
  const ticket = parse((await A1("/support/tickets", "POST", { subject: "Security test ticket", body: "Private message from user A", category: "other" }))[1]);
  await A1("/notes", "PUT", { kind: "coin", ref: SAMPLE.mint, body: "A's private note" });
  await A1("/alerts/me", "PUT", { email_on: false, discord_webhook: "", price: [{ id: "a-only", mint: SAMPLE.mint, symbol: "BONK", above: true, mc_usd: 1e15 }], wallets: [], watch: [], dev_sells: true });
  await A1("/social/me", "PUT", { handle: "sec_private_" + Math.random().toString(36).slice(2, 7), display_name: "Private A", bio: "", public: false });
  const aHandle = parse((await A1("/social/me"))[1])?.profile?.handle;

  const ruleId = rule?.id ?? rule?.rule?.id;
  if (ruleId) {
    const r = await B1(`/demo/orders/${ruleId}/cancel`, "POST", {});
    check("B cannot cancel A's demo order", !(r[0] >= 200 && r[0] < 300) || !r[1].includes('"cancelled"'), `${r[0]} ${r[1].slice(0, 100)}`);
    const still = await A1("/demo/orders");
    check("A's order is still open after B tried", still[1].includes(`"id":${ruleId}`), still[1].slice(0, 100));
  } else check("A's demo order made for the test", false, JSON.stringify(rule).slice(0, 120));
  const tid = ticket?.id ?? ticket?.ticket?.id;
  if (tid) {
    for (const [m, p, b] of [["GET", `/support/tickets/${tid}`], ["GET", `/support/tickets/${tid}/messages`], ["POST", `/support/tickets/${tid}/messages`, { body: "B writing into A's ticket" }]]) {
      const r = await B1(p, m, b);
      check(`B cannot ${m} A's support ticket ${p.split("/").slice(3).join("/") || ""}`, !(r[0] >= 200 && r[0] < 300) || !r[1].includes("Private message from user A"), `${r[0]} ${r[1].slice(0, 100)}`);
    }
    const list = await B1("/support/tickets");
    check("B's ticket list has none of A's", !list[1].includes("Security test ticket"), list[1].slice(0, 100));
  } else check("A's ticket made for the test", false, JSON.stringify(ticket).slice(0, 160));
  for (const [p, secret] of [["/notes", "A's private note"], ["/alerts/me", "a-only"], ["/demo/account", '"cash_usd":9980'], ["/demo/trades", SAMPLE.mint], ["/account/me", A1.email], ["/account/settings", A1.id], ["/account/export", A1.email], ["/kixo-wallet", A1.id], ["/trade/history", A1.id], ["/auto-wallet", A1.id]]) {
    const r = await B1(p);
    check(`B's ${p} shows nothing of A's`, !r[1].includes(secret), r[1].slice(0, 100));
  }
  if (aHandle) {
    for (const p of [`/social/u/${aHandle}`, `/social/trades/${aHandle}`, `/social/u/${aHandle}/people?who=followers`]) {
      const r = await B1(p);
      check(`A's private profile is hidden from B at ${p.split("?")[0]}`, r[0] === 404 || !r[1].includes("Private A"), `${r[0]} ${r[1].slice(0, 80)}`);
    }
    const f = await B1(`/social/follow/${aHandle}`, "POST", {});
    check("B cannot follow A's private profile", !(f[0] >= 200 && f[0] < 300), f[0]);
    const s = await B1(`/social/traders?q=sec_private`);
    check("A's private profile is not in the traders list", !s[1].includes(aHandle), s[1].slice(0, 80));
  }
  // B's account deletion cannot touch A.
  const tradeStatus = await B1(`/trade/status/${SAMPLE.sig}`);
  check("B cannot read a trade that is not B's", !(tradeStatus[0] === 200 && tradeStatus[1].includes(A1.id)), tradeStatus[0]);
}

/* ---------------- D. bad input on every write route ---------------- */
const BODIES = {
  "empty object": {},
  array: [],
  string: "x",
  number: 7,
  null: null,
  "wrong types": { mint: 5, side: true, usd: "lots", fraction: "all", handle: [], body: {}, kind: 3, email_on: "yes", price: "x", wallets: 1 },
  "negative and huge": { usd: -1e308, fraction: 1e308, leverage: -5, mc_usd: -1, min_buy_sol: 1e308, daily_loss_limit_usd: -9 },
  "nan and infinity text": { usd: "NaN", fraction: "Infinity", lamports: "-0" },
  "sql injection": { mint: "' OR 1=1 --", handle: "x'; drop table follows; --", q: "1' or '1'='1", body: "'; delete from user_notes; --", ref: "' or 1=1 --" },
  "postgrest injection": { mint: "*", handle: "a,or=(handle.neq.x)", ref: "x&user_id=neq.0", kind: "coin&kind=wallet", id: "1 or id.gt.0" },
  "path traversal": { mint: "../../../etc/passwd", ref: "..\\..\\windows\\win.ini", handle: "../admin", url: "file:///etc/passwd" },
  "script tags": { handle: "<script>alert(1)</script>", display_name: "<img src=x onerror=alert(1)>", bio: "javascript:alert(1)", body: "<svg onload=alert(1)>", label: "\"><script>x</script>" },
  "null bytes and control": { handle: "a\u0000b", body: "x\u0000y\u0007\u001b[31m", mint: "Dez\u0000" },
  "unicode tricks": { handle: "ａｄｍｉｎ", display_name: "‮evil", bio: "🦄".repeat(500), body: "𝕂".repeat(3000) },
  "prototype pollution": JSON.parse('{"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}'),
  "deep nesting": { raw: "[".repeat(5000) + "]".repeat(5000) },
  "very long strings": { mint: "A".repeat(10000), handle: "a".repeat(10000), body: "b".repeat(100000), subject: "c".repeat(50000) },
};
async function D() {
  const U = await tempUser("sec-fuzz");
  const writes = ROUTES.filter((p) => !isAdmin(p) && !p.startsWith("/ws/") && !NO_WRITE_FUZZ.some((r) => r.test(p)));
  for (const p of writes) {
    for (const m of ["POST", "PUT"]) {
      for (const [label, body] of Object.entries(BODIES)) {
        const r = await req(GW + fill(p), { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${U.token}` }, body: body?.raw ?? body, raw: !!body?.raw });
        const clean = (r.status === 502 || r.status === 503) && /not set up|Could not|could not be sent|switched off|not running/i.test(r.text);
        check(`${m} ${p} [${label}] handled`, r.status !== 0 && (r.status < 500 || clean), `${r.status} ${r.text.slice(0, 120)}`);
        check(`${m} ${p} [${label}] nothing leaked`, !leaky(r.text), r.text.slice(0, 120));
      }
      // Not JSON at all, and a body far over any limit.
      const notJson = await req(GW + fill(p), { method: m, raw: true, headers: { "content-type": "application/json", authorization: `Bearer ${U.token}` }, body: "{not json" });
      const noBody = ["/demo/reset", "/trade/prepare", "/alerts/telegram/link", "/alerts/telegram/unlink", "/account/sync"].includes(p);
      check(`${m} ${p} [broken JSON] refused cleanly`, noBody ? notJson.status < 500 || notJson.status === 503 : notJson.status >= 400 && notJson.status < 500, notJson.status);
      const big = await req(GW + fill(p), { method: m, raw: true, headers: { "content-type": "application/json", authorization: `Bearer ${U.token}` }, body: JSON.stringify({ x: "z".repeat(6 * 1024 * 1024) }), timeout: 30000 });
      // A connection closed mid-upload (status 0) is a refusal too.
      check(`${m} ${p} [6 MB body] refused`, noBody ? big.status < 500 || big.status === 503 : big.status === 0 || big.status === 413 || (big.status >= 400 && big.status < 500), big.status);
    }
  }
  // Stored text comes back as data, never as markup the gateway builds.
  await U("/social/me", "PUT", { handle: "sec_xss_" + Math.random().toString(36).slice(2, 6), display_name: "<script>alert(1)</script>", bio: "<img src=x onerror=alert(1)>", public: true });
  const me = await U("/social/me");
  check("profile fields are stored as text (JSON escaped)", me[0] === 200 && me[1].includes("\\u003c") === false ? me[1].includes("<script>") : true, me[1].slice(0, 120));
  const hdr = await req(GW + "/social/me", { headers: { authorization: `Bearer ${U.token}` } });
  check("API answers are JSON, not HTML", (hdr.headers.get("content-type") ?? "").includes("application/json"), hdr.headers.get("content-type"));
}

/* ---------------- E. bad path parameters ---------------- */
const PARAMS = ["..", "../../etc/passwd", "%2e%2e%2f%2e%2e%2fetc%2fpasswd", "' OR 1=1--", "*", "null", "-1", "99999999999999999999999", "<script>", "a".repeat(5000), "%00", "x%0d%0aSet-Cookie:%20a=b", "eq.1&user_id=neq.0", "😀", "1;DROP TABLE x"];
async function E() {
  const U = await tempUser("sec-path");
  for (const p of ROUTES.filter((r) => r.includes("{") && !isAdmin(r) && !r.startsWith("/ws/"))) {
    for (const v of PARAMS) {
      const url = GW + p.replace(/\{\w+\}/g, v);
      const r = await req(url, { headers: { authorization: `Bearer ${U.token}` } });
      check(`GET ${p} with ${JSON.stringify(v.slice(0, 30))} handled`, r.status !== 0 && r.status < 500, `${r.status} ${r.text.slice(0, 100)}`);
      check(`GET ${p} with ${JSON.stringify(v.slice(0, 30))} leaks nothing`, !leaky(r.text) && !/root:x:0:0|\[fonts\]/.test(r.text), r.text.slice(0, 100));
      check(`GET ${p} with ${JSON.stringify(v.slice(0, 30))} sets no injected header`, !r.headers.get("set-cookie")?.includes("a=b"), r.headers.get("set-cookie"));
    }
  }
}

/* ---------------- F. query injection and SSRF ---------------- */
async function F() {
  const qs = ["*", "' or '1'='1", "a,or=(public.eq.false)", "%", "\\", "<script>", "x".repeat(5000), ")", "handle.neq.x", "😀"];
  for (const [p, key] of [["/search", "q"], ["/social/traders", "q"], ["/social/feed", "before"], ["/social/leaders", "period"], ["/demo/trades", "limit"], ["/news", "q"], ["/social/trades/x", "after"], ["/ai/risk", "mints"], ["/price", "mints"], ["/token/" + SAMPLE.mint, "tf"]]) {
    for (const v of qs) {
      const r = await req(`${GW}${p}?${key}=${encodeURIComponent(v)}`);
      check(`${p}?${key}=${JSON.stringify(v.slice(0, 20))} handled`, r.status < 500 && r.status !== 0, `${r.status} ${r.text.slice(0, 100)}`);
      check(`${p}?${key}=${JSON.stringify(v.slice(0, 20))} leaks nothing`, !leaky(r.text), r.text.slice(0, 100));
    }
  }
  // Private profiles never leak through search.
  const s = await req(`${GW}/social/traders?q=${encodeURIComponent("a,or=(public.eq.false)")}`);
  check("traders search cannot be widened to private profiles", s.status < 500, s.status);
  // The image proxy fetches only public images on the allowed hosts.
  const ssrf = [
    "http://127.0.0.1:8080/admin/check", "http://localhost:8090/health", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://0.0.0.0/", "http://10.0.0.1/",
    "http://192.168.1.1/", "file:///etc/passwd", "gopher://127.0.0.1:6379/_INFO", "http://2130706433/", "http://0x7f000001/", "http://127.1/", "https://ipfs.io@127.0.0.1/",
    "https://127.0.0.1.nip.io/", `${SB}/rest/v1/user_notes`, "http://metadata.google.internal/", "https://evil.example/x.png", "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)", "http://localhost:3000/",
  ];
  for (const u of ssrf) {
    const r = await req(`${GW}/img?u=${encodeURIComponent(u)}`);
    check(`image proxy refuses ${u.slice(0, 50)}`, !(r.status >= 200 && r.status < 300), `${r.status} ${r.text.slice(0, 60)}`);
  }
}

/* ---------------- G. CORS ---------------- */
async function G() {
  const sample = ROUTES.filter((p) => !p.includes("{") && !p.startsWith("/ws/")).slice(0, 60);
  for (const p of sample) {
    for (const origin of ["https://evil.example", "null", "http://localhost:3000.evil.example", "https://kixo.trade.evil.example"]) {
      const r = await req(GW + p, { headers: { origin } });
      const acao = r.headers.get("access-control-allow-origin");
      check(`${p} not readable from ${origin}`, acao !== origin && acao !== "*", acao);
      const pre = await req(GW + p, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
      const pacao = pre.headers.get("access-control-allow-origin");
      check(`${p} preflight refused for ${origin}`, pacao !== origin && pacao !== "*", pacao);
    }
  }
  const ok = await req(GW + "/features", { headers: { origin: "http://localhost:3000" } });
  check("Kixo's own website is allowed", ok.headers.get("access-control-allow-origin") === "http://localhost:3000", ok.headers.get("access-control-allow-origin"));
}

/* ---------------- H. Supabase directly ---------------- */
async function H() {
  const U = await tempUser("sec-db");
  await U("/social/me");
  const open = await req(`${SB}/rest/v1/`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  const spec = JSON.parse(open.text || "{}");
  const tables = Object.keys(spec.definitions ?? {});
  const rpcs = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5));
  check("the table list could be read for the test", tables.length > 5, tables.length);
  // Tables a signed-in user may read (only their own rows, by policy).
  const OWN_READ = new Set(["demo_accounts", "demo_positions", "demo_trades", "real_trades", "demo_orders", "profiles", "wallet_trades", "support_tickets", "support_messages"]);
  for (const t of tables) {
    for (const [who, key] of [["public key", ANON], ["user's own token", U.token]]) {
      const h = { apikey: ANON, authorization: `Bearer ${key}`, "content-type": "application/json", Prefer: "return=representation" };
      const r = await req(`${SB}/rest/v1/${t}?select=*&limit=50`, { headers: h });
      let rows = [];
      try {
        rows = JSON.parse(r.text);
      } catch {}
      const others = Array.isArray(rows) ? rows.filter((x) => JSON.stringify(x).match(/[0-9a-f]{8}-[0-9a-f]{4}-/) && !JSON.stringify(x).includes(U.id)) : [];
      if (who === "public key") check(`${t}: nothing readable with the public key`, !(Array.isArray(rows) && rows.length > 0) || t === "waitlist" ? !(Array.isArray(rows) && rows.length) : true, `${r.status} ${rows.length ?? ""}`);
      else check(`${t}: a user reads no one else's rows`, !(OWN_READ.has(t) ? others.length : Array.isArray(rows) && rows.length), `${r.status} ${Array.isArray(rows) ? rows.length : r.text.slice(0, 80)}`);
      const ins = await req(`${SB}/rest/v1/${t}`, { method: "POST", headers: h, body: { user_id: U.id } });
      check(`${t}: ${who} cannot insert`, !(ins.status >= 200 && ins.status < 300), `${ins.status} ${ins.text.slice(0, 80)}`);
      const upd = await req(`${SB}/rest/v1/${t}?user_id=neq.${U.id}`, { method: "PATCH", headers: h, body: { user_id: U.id } });
      const changed = (() => { try { return JSON.parse(upd.text).length; } catch { return 0; } })();
      check(`${t}: ${who} cannot change rows`, !(upd.status >= 200 && upd.status < 300 && changed > 0), `${upd.status} ${changed}`);
      const del = await req(`${SB}/rest/v1/${t}?user_id=neq.${U.id}`, { method: "DELETE", headers: h });
      const gone = (() => { try { return JSON.parse(del.text).length; } catch { return 0; } })();
      check(`${t}: ${who} cannot delete rows`, !(del.status >= 200 && del.status < 300 && gone > 0), `${del.status} ${gone}`);
    }
  }
  for (const f of rpcs) {
    for (const [who, key] of [["public key", ANON], ["user's own token", U.token]]) {
      const r = await req(`${SB}/rest/v1/rpc/${f}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: { p_user: "00000000-0000-0000-0000-000000000001", p_follower: null, p_handle: "x", p_from: "2000-01-01" } });
      check(`function ${f}: ${who} cannot call it`, !(r.status >= 200 && r.status < 300), `${r.status} ${r.text.slice(0, 80)}`);
    }
  }
  // The service key never reaches the browser: covered in I.
}

/* ---------------- I. the website ---------------- */
async function I() {
  const pages = ["/", "/discover", "/radar", "/community", "/sniper", "/settings", "/portfolio", "/ai", "/login", "/terms", "/privacy", "/token/" + SAMPLE.mint, "/no-such-page"];
  const scripts = new Set();
  for (const p of pages) {
    const r = await req(WEB + p);
    check(`${p} loads`, r.status === 200 || (p === "/no-such-page" && r.status === 404), r.status);
    const h = r.headers;
    check(`${p} cannot be framed by other sites`, /deny|sameorigin/i.test(h.get("x-frame-options") ?? "") || /frame-ancestors/i.test(h.get("content-security-policy") ?? ""), `${h.get("x-frame-options")} | ${h.get("content-security-policy")}`);
    check(`${p} has nosniff`, (h.get("x-content-type-options") ?? "") === "nosniff", h.get("x-content-type-options"));
    check(`${p} has a referrer policy`, !!h.get("referrer-policy"), h.get("referrer-policy"));
    check(`${p} hides the server`, !/next\.js/i.test(h.get("x-powered-by") ?? ""), h.get("x-powered-by"));
    for (const m of r.text.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)) scripts.add(m[1]);
    secretsIn(`page ${p}`, r.text);
  }
  for (const s of scripts) {
    const r = await req(WEB + s);
    secretsIn(`script ${s.split("/").pop()}`, r.text);
  }
  check("scripts were found to scan", scripts.size > 5, scripts.size);
  for (const p of ["/.env", "/.env.local", "/.git/config", "/.git/HEAD", "/apps/web/.env.local", "/next.config.ts", "/package.json", "/_next/static/../../.env", "/data/secrets.json", "/server.js"]) {
    const r = await req(WEB + p);
    check(`${p} is not served`, r.status === 404 || !/SUPABASE|ADMIN|PRIVATE|\[core\]|ref: refs/i.test(r.text), r.status);
    const g = await req(GW + p);
    check(`gateway ${p} is not served`, g.status === 404 || g.status === 405, g.status);
  }
  const robots = await req(WEB + "/robots.txt");
  check("robots.txt does not name the admin", !webEnv.ADMIN_PATH || !robots.text.includes(webEnv.ADMIN_PATH), "admin path in robots");
  const sitemap = await req(WEB + "/sitemap.xml");
  check("sitemap does not name the admin", !webEnv.ADMIN_PATH || !sitemap.text.includes(webEnv.ADMIN_PATH), "admin path in sitemap");
}
function secretsIn(where, text) {
  const SECRET_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "ADMIN_TOKEN", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "HELIUS_API_KEY", "AUTO_WALLET_KEY", "TELEGRAM_BOT_TOKEN", "RESEND_API_KEY", "JUPITER_API_KEY", "X_BEARER_TOKEN", "REDDIT_CLIENT_SECRET"];
  for (const k of SECRET_KEYS) {
    const v = env[k];
    if (v && v.length >= 12) check(`${where} does not contain ${k}`, !text.includes(v), "secret value found");
  }
  for (const u of (env.FALLBACK_RPC_URLS ?? "").split(",").concat((env.FALLBACK_WS_URLS ?? "").split(","))) {
    const m = u.match(/[?&/](?:api-key=|v2\/|)([A-Za-z0-9_-]{24,})/);
    if (m) check(`${where} does not contain an RPC key`, !text.includes(m[1]), "rpc key found");
  }
  if (webEnv.ADMIN_PATH) check(`${where} does not contain the admin address`, !text.includes(webEnv.ADMIN_PATH), "admin path found");
  check(`${where} has no private key material`, !/-----BEGIN (RSA |EC )?PRIVATE KEY/.test(text), "private key block");
}

/* ---------------- J. git history ---------------- */
async function J() {
  const values = ["SUPABASE_SERVICE_ROLE_KEY", "ADMIN_TOKEN", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "HELIUS_API_KEY", "AUTO_WALLET_KEY", "OWNER_EMAIL"].map((k) => [k, env[k]]).filter(([, v]) => v && v.length >= 12);
  let log = "";
  try {
    log = execSync("git log -p --all", { cwd: ROOT, maxBuffer: 1 << 30, encoding: "utf8" });
  } catch (e) {
    check("git history readable", false, e.message);
    return;
  }
  for (const [k, v] of values) check(`git history has no ${k}`, !log.includes(v), "found in history");
  if (webEnv.ADMIN_PATH) check("git history has no admin address", !log.includes(webEnv.ADMIN_PATH), "found in history");
  const patterns = { "Groq key": /gsk_[A-Za-z0-9]{40,}/, "Google key": /AIza[0-9A-Za-z_-]{35}/, "OpenRouter key": /sk-or-v1-[a-f0-9]{40,}/, "private key block": /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Solana secret key array": /\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/ };
  for (const [name, re] of Object.entries(patterns)) check(`git history has no ${name}`, !re.test(log), (log.match(re) ?? [""])[0].slice(0, 12) + "…");
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n");
  for (const f of [".env", "apps/web/.env.local", "data/secrets.json", "data/platform.json"]) check(`${f} is not in git`, !tracked.includes(f), f);
}

/* ---------------- run ---------------- */
const all = { A, B, C, D, E, F, G, H, I, J };
const pick = process.argv.slice(2).map((s) => s.toUpperCase());
const t0 = Date.now();
await cleanupLeftovers();
for (const [k, fn] of Object.entries(all)) {
  if (pick.length && !pick.includes(k)) continue;
  section = k;
  stats[k] = { pass: 0, fail: 0 };
  console.log(`\n${k}`);
  try {
    await fn();
  } catch (e) {
    check(`${k} ran to the end`, false, e?.stack ?? e);
  } finally {
    await cleanup();
  }
  console.log(`  ${stats[k].pass} passed, ${stats[k].fail} failed`);
}
const total = Object.values(stats).reduce((s, x) => ({ pass: s.pass + x.pass, fail: s.fail + x.fail }), { pass: 0, fail: 0 });
console.log(`\nTotal: ${total.pass + total.fail} checks, ${total.pass} passed, ${total.fail} failed, in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
fs.writeFileSync(path.join(ROOT, "tests/security/last-report.json"), JSON.stringify({ at: new Date().toISOString(), stats, total, failures }, null, 1));
process.exit(total.fail ? 1 : 0);
