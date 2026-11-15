// Kixo end-to-end checks against the running gateway and website (start them first with
// scripts\kixo-start.cmd). Uses temporary accounts, deleted at the end.
//
//   node tests/e2e/run.mjs            every group
//   node tests/e2e/run.mjs demo alerts  only these groups
//
// Exit code 1 when anything failed, so it can gate a deploy.
import { groups } from "./checks.mjs";
import { cleanup, cleanupLeftovers, results } from "./lib.mjs";

const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(groups);
const unknown = names.filter((n) => !groups[n]);
if (unknown.length) {
  console.error(`Unknown group: ${unknown.join(", ")}. Groups: ${Object.keys(groups).join(", ")}`);
  process.exit(2);
}

const t0 = Date.now();
const left = await cleanupLeftovers();
if (left) console.log(`(removed ${left} test accounts left by an earlier run)`);
for (const n of names) {
  console.log(`\n${n}`);
  try {
    await groups[n]();
  } catch (e) {
    results.fail++;
    console.log(`  FAIL  ${n} stopped: ${e instanceof Error ? e.message : e}`);
  } finally {
    await cleanup();
  }
}
console.log(`\n${results.pass} passed, ${results.fail} failed, ${results.skip} skipped in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(results.fail ? 1 : 0);
