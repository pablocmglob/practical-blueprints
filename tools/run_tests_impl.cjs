#!/usr/bin/env node
/** run_tests_impl.cjs — minimal test runner for the policy suite.
 * Usage: node tools/run_tests.py [path-filter] */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const POLICY_DIR = path.join(ROOT, "tests", "policy");

async function main() {
  const filter = process.argv[2];
  const files = fs
    .readdirSync(path.join(ROOT, "tests", "policy"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) => !filter || f.includes(filter))
    .sort();

  let failed = 0;
  let total = 0;
  for (const f of files) {
    const mod = require(path.join(POLICY_DIR, f));
    if (typeof mod.run !== "function") continue;
    const results = await mod.run();
    for (const r of results) {
      total++;
      if (!r.pass) {
        failed++;
        console.log(`FAIL  ${r.name}`);
        if (r.detail) console.log(`      ${r.detail}`);
      } else {
        console.log(`ok    ${r.name}`);
      }
    }
  }
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed ? 1 : 0);
}

main();
