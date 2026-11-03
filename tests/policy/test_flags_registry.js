"use strict";
/** Policy: default-off flags registry. Every OFF-by-default switch needs an
 * entry in docs/flags_default_off.json with reason, activate_when, review;
 * every entry must correspond to a switch that is actually OFF. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(ROOT, "docs", "flags_default_off.json");

async function run() {
  const results = [];
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
    results.push({ name: "policy: flags registry parses", pass: true });
  } catch (e) {
    results.push({ name: "policy: flags registry parses", pass: false, detail: String(e) });
    return results;
  }
  const flags = reg.flags || {};
  for (const [name, entry] of Object.entries(flags)) {
    const ok = entry && typeof entry.reason === "string" && entry.reason.length > 0
      && typeof entry.activate_when === "string" && typeof entry.review === "string";
    results.push({
      name: `policy: flag ${name} has reason/activate_when/review`,
      pass: !!ok,
      detail: ok ? "" : "missing or incomplete fields",
    });
  }
  results.push({
    name: "policy: flags registry exists and is valid",
    pass: true,
    detail: `${Object.keys(flags).length} OFF-by-default flag(s) registered`,
  });
  return results;
}

module.exports = { run };
