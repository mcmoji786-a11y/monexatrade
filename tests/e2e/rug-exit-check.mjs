// Live check of Rug exit (gateway rug_exit.rs), AI path: a temporary account turns Rug
// exit on, buys $5 of demo in a coin Kixo AI calls Danger right now, and the gateway must
// sell it by itself within a minute. The account is deleted at the end.
// Run (gateway up): node tests/e2e/rug-exit-check.mjs
import { tempUser, cleanup, check, results, json, sleep, GW } from "./lib.mjs";

const ov = json(await (await fetch(`${GW}/ai/overview`)).text());
const danger = (ov?.riskiest ?? []).filter((p) => p.dump >= 0.4);
if (!danger.length) {
  console.log("  SKIP  no coin is Danger right now; try again in a few minutes");
  process.exit(0);
}

const A = await tempUser("rug");
try {
  let [st, body] = await A("/account/settings");
  const s = json(body);
  s.safety = { ...s.safety, rug_exit: true, rug_exit_dev: false, rug_exit_ai: true };
  [st] = await A("/account/settings", "PUT", s);
  check("rug exit turned on", st === 200);

  let bought = null;
  for (const p of danger.slice(0, 8)) {
    const [s2] = await A("/demo/order", "POST", { mint: p.mint, side: "buy", usd: 5 });
    if (s2 === 200) {
      bought = p;
      break;
    }
  }
  if (!bought) throw new Error("no Danger coin could be bought (no price yet)");
  console.log(`  bought $5 of ${bought.symbol || bought.mint.slice(0, 6)} (AI crash chance ${(bought.dump * 100).toFixed(0)}%)`);

  let sell = null;
  for (let i = 0; i < 30 && !sell; i++) {
    await sleep(3000);
    const trades = json((await A("/demo/trades?limit=10"))[1]) ?? [];
    sell = trades.find((t) => t.side === "sell" && t.mint === bought.mint);
  }
  check("gateway sold it by itself", !!sell, sell ? `after the AI said Danger, source ${sell.source}` : "no sell within 90 s");
  if (sell) check("recorded as rug exit (or stop loss before migration 0018)", sell.source === "rug_exit" || sell.source === "sl", sell.source);
  const [, acct] = await A("/demo/account");
  check("position closed", !(json(acct)?.positions ?? []).some((p) => p.mint === bought.mint && Number(p.tokens) > 0));
} finally {
  await cleanup();
}
console.log(`\n${results.pass} passed, ${results.fail} failed`);
process.exit(results.fail ? 1 : 0);
