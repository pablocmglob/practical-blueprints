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
    let mod;
    try {
      mod = require(path.join(POLICY_DIR, f));
    } catch (err) {
      failed++;
      total++;
      console.log(`FAIL  ${f}: module threw on require`);
      console.log(`      ${err.message}`);
      continue;
    }
    if (typeof mod.run !== "function") {
      failed++;
      total++;
      console.log(`FAIL  ${f}: no runnable export`);
      console.log(`      policy test files must export run() — a gutted file must fail the gate, not count as zero`);
      continue;
    }
    let results;
    try {
      results = await mod.run();
    } catch (err) {
      failed++;
      total++;
      console.log(`FAIL  ${f}: run() threw`);
      console.log(`      ${err.message}`);
      continue;
    }
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
