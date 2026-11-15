// KOL Tracker check on live data: takes a wallet that is trading right now, lists it as a
// temporary KOL, checks the list, the coin badge data and the live stream, then puts the
// admin's list back exactly as it was. Needs ADMIN_TOKEN in .env and runs from this PC.
import { env, GW, sleep } from "./lib.mjs";

const admin = { "x-admin-token": env.ADMIN_TOKEN, "content-type": "application/json" };
const ok = (name, cond, extra = "") => console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${extra ? `  (${String(extra).slice(0, 160)})` : ""}`);

const before = (await (await fetch(`${GW}/admin/kols`, { headers: admin })).json()).kols ?? [];
// A wallet buying on the live stream right now.
const wallet = await new Promise((resolve) => {
  const ws = new WebSocket(`${GW.replace("http", "ws")}/ws/chain-trades?min_sol=0.2`);
  const t = setTimeout(() => (ws.close(), resolve(null)), 60_000);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.trade?.is_buy) {
      clearTimeout(t);
      ws.close();
      resolve(m.trade.wallet);
    }
  };
});
if (!wallet) {
  console.log("  SKIP  no live trade within a minute");
  process.exit(0);
}
try {
  let r = await fetch(`${GW}/admin/kols`, { method: "PUT", headers: admin, body: JSON.stringify({ kols: [...before, { address: wallet, name: "Test KOL", x: "kixo_test" }] }) });
  ok("admin saves a KOL", r.status === 200, r.status);
  r = await fetch(`${GW}/admin/kols`, { method: "PUT", headers: admin, body: JSON.stringify({ kols: [{ address: "not-an-address", name: "x" }] }) });
  ok("a bad address is refused", r.status === 400, r.status);
  r = await fetch(`${GW}/admin/kols`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kols: [] }) });
  ok("no key: refused", r.status === 403 || r.status === 404, r.status);
  const list = (await (await fetch(`${GW}/kols`)).json()).kols;
  ok("public list shows the KOL", list.some((k) => k.address === wallet && k.name === "Test KOL"));
  // Its next buy shows up on the coin and in the stream.
  const seen = await new Promise((resolve) => {
    const ws = new WebSocket(`${GW.replace("http", "ws")}/ws/kols`);
    let history = false;
    const t = setTimeout(() => (ws.close(), resolve({ history, live: null })), 120_000);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "history") history = true;
      if (m.type === "trade" && m.kol?.name === "Test KOL") {
        clearTimeout(t);
        ws.close();
        resolve({ history, live: m });
      }
    };
  });
  ok("stream opens with history", seen.history);
  if (seen.live) {
    ok("a live KOL trade arrives, named", seen.live.kol?.x === "kixo_test", seen.live.symbol);
    if (seen.live.trade.is_buy) {
      await sleep(500);
      const coins = (await (await fetch(`${GW}/kols/coins`)).json()).coins;
      ok("the coin carries the KOL badge", (coins[seen.live.mint] ?? []).some((k) => k.name === "Test KOL"));
      const one = (await (await fetch(`${GW}/kols/coin/${seen.live.mint}`)).json()).kols;
      ok("the coin lists the KOL", one.some((k) => k.address === wallet));
    }
  } else console.log("  SKIP  the wallet did not trade again within two minutes");
} finally {
  const r = await fetch(`${GW}/admin/kols`, { method: "PUT", headers: admin, body: JSON.stringify({ kols: before }) });
  console.log(`  admin list restored (${r.status}, ${before.length} KOLs)`);
}
