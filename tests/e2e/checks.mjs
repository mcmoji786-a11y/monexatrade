// Every end-to-end check, grouped by area. Each group gets fresh temporary accounts.
// A group whose database update has not been run reports SKIP, not FAIL.
import { BONK, check, GW, json, skip, sleep, tempUser } from "./lib.mjs";

const notSetUp = (t) => /not set up/i.test(t);

export const groups = {
  async health() {
    const h = await fetch(`${GW}/health`).then((r) => r.status).catch(() => 0);
    check("gateway answers /health", h === 200, h);
    const f = await fetch(`${GW}/features`).then((r) => r.json()).catch(() => null);
    check("feature switches load", !!f && typeof f === "object");
    const web = await fetch("http://localhost:3000/").then((r) => r.status).catch(() => 0);
    check("website answers", web === 200, web);
    const missing = await fetch("http://localhost:3000/no-such-page-kixo").then((r) => r.status).catch(() => 0);
    check("unknown page is a 404", missing === 404, missing);
    const s = await fetch(`${GW}/search?q=BONK`).then((r) => r.status).catch(() => 0);
    check("coin search answers", s === 200, s);
  },

  async demo() {
    const A = await tempUser("demo");
    let r = await A("/demo/account");
    check("demo account starts at $10,000", r[0] === 200 && json(r[1])?.cash_usd === 10000, r[1]);
    r = await A("/demo/order", "POST", { mint: BONK, side: "buy", usd: 50 });
    check("demo buy", r[0] === 200, r[0] === 200 ? "" : r[1]);
    r = await A("/demo/order", "POST", { mint: BONK, side: "sell", fraction: 1 });
    check("demo sell", r[0] === 200, r[0] === 200 ? "" : r[1]);
    r = await A("/demo/order", "POST", { mint: BONK, side: "buy", usd: 0.5 });
    check("order under $1 refused", r[0] === 400);
  },

  async lossLimit() {
    const A = await tempUser("limit");
    let r = await A("/account/settings", "PUT", { safety: { daily_loss_limit_usd: 1, day_offset_min: 300, warn_danger: true } });
    check("loss limit saved", r[0] === 200 && r[1].includes('"daily_loss_limit_usd":1'));
    await A("/demo/order", "POST", { mint: BONK, side: "buy", usd: 400 });
    r = await A("/demo/order", "POST", { mint: BONK, side: "sell", fraction: 1 });
    const lost = -(json(r[1])?.realized_usd ?? 0);
    r = await A("/account/limits");
    check("limits report today's loss", r[0] === 200 && json(r[1])?.demo_lost_usd > 0, r[1]);
    r = await A("/demo/order", "POST", { mint: BONK, side: "buy", usd: 10 });
    if (lost >= 1) check("buying paused after the limit", r[0] === 403, r[1]);
    else skip("buying paused after the limit", `loss was only $${lost.toFixed(2)}`);
    await A("/account/settings", "PUT", { safety: { daily_loss_limit_usd: 0, day_offset_min: 300, warn_danger: true } });
    r = await A("/demo/order", "POST", { mint: BONK, side: "buy", usd: 10 });
    check("limit off: buying again", r[0] === 200, r[0] === 200 ? "" : r[1]);
  },

  async community() {
    const [A, B] = [await tempUser("ca"), await tempUser("cb")];
    let r = await A("/social/me");
    if (notSetUp(r[1])) return skip("community", "run supabase/migrations/0012_social.sql");
    const me = json(r[1])?.profile;
    check("profile made automatically", !!me?.handle, r[1]);
    const handle = "e2e_" + Math.random().toString(36).slice(2, 8);
    r = await A("/social/me", "PUT", { handle, display_name: "E2E Trader", bio: "test", public: true });
    check("profile edited", r[0] === 200, r[1]);
    await A("/demo/order", "POST", { mint: BONK, side: "buy", usd: 25 });
    r = await B(`/social/follow/${handle}`, "POST");
    check("follow", r[0] === 200, r[1]);
    r = await B("/social/feed?scope=following");
    check("following feed shows the trade", r[0] === 200 && r[1].includes(handle));
    r = await B(`/social/traders?q=${handle}`);
    check("traders search", r[0] === 200 && json(r[1])?.traders?.[0]?.i_follow === true, r[1]);
    r = await B(`/social/u/${handle}/people?who=followers`);
    check("followers list", r[0] === 200 && json(r[1])?.people?.length === 1, r[1]);
    r = await B(`/social/follow/${handle}`, "DELETE");
    check("unfollow", r[0] === 200);
  },

  async alerts() {
    const A = await tempUser("al");
    let r = await A("/alerts/me");
    if (notSetUp(r[1])) return skip("alerts", "run supabase/migrations/0015_alerts.sql");
    check("alerts load", r[0] === 200, r[1]);
    const hook = "https://discord.com/api/webhooks/123456789012345678/" + "x".repeat(60);
    r = await A("/alerts/me", "PUT", { email_on: false, discord_webhook: hook, price: [{ id: "up", mint: BONK, symbol: "BONK", above: true, mc_usd: 1 }, { id: "down", mint: BONK, symbol: "BONK", above: false, mc_usd: 1 }], wallets: [], watch: [], dev_sells: true });
    check("alert rules saved", r[0] === 200 && r[1].includes('"saved":true'), r[0] === 200 ? "" : r[1]);
    r = await A("/alerts/me", "PUT", { email_on: false, discord_webhook: "https://evil.com/x" });
    check("a non-Discord link is refused", r[0] === 400);
    let fired = false;
    for (let i = 0; i < 20 && !fired; i++) {
      await sleep(2000);
      fired = !(await A("/alerts/me"))[1].includes('"id":"up"');
    }
    check("price alert fired by the gateway and removed", fired);
    check("other alert still waiting", (await A("/alerts/me"))[1].includes('"id":"down"'));
  },

  async notes() {
    const A = await tempUser("nt");
    let r = await A("/notes");
    if (notSetUp(r[1])) return skip("notes", "run supabase/migrations/0016_notes.sql");
    r = await A("/notes", "PUT", { kind: "coin", ref: BONK, label: "BONK", body: "Bought on the dip" });
    check("note saved", r[0] === 200, r[1]);
    r = await A("/notes");
    check("note listed", r[0] === 200 && r[1].includes("Bought on the dip"));
    r = await A("/notes", "PUT", { kind: "coin", ref: BONK, body: "" });
    check("empty note deletes it", r[0] === 200 && !(await A("/notes"))[1].includes("Bought on the dip"));
  },

  async backtest() {
    const st = await fetch("http://127.0.0.1:8090/backtest/status").then((r) => r.json()).catch(() => null);
    if (!st) return skip("sniper test", "the AI service is not running");
    if (!st.ready) return skip("sniper test", "the last 24 hours are still loading");
    const r = await fetch(`${GW}/sniper/backtest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxAgeSecs: 300, aiMaxDump: 20, aiMinPump: 20, takeProfitPct: 200, stopLossPct: 20, trailingPct: 20, maxHoldMins: 10, slippagePct: 1, sizeUsd: 25, maxOpen: 5, maxPerHour: 20 }) });
    const v = await r.json().catch(() => null);
    check("sniper test on yesterday answers", r.status === 200 && v?.ready === true && typeof v.trades === "number", JSON.stringify(v).slice(0, 120));
  },
};
