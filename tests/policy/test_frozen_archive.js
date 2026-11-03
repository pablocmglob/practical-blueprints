"use strict";
/** Policy: .tasks/archive is frozen read-only. Red first: the rule existed
 * (archive README) before this test; adding a file there fails. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ARCHIVE = path.join(ROOT, ".tasks", "archive");

async function run() {
  const results = [];
  if (!fs.existsSync(ARCHIVE)) {
    results.push({ name: "policy: .tasks/archive frozen (no task files added)", pass: true, detail: "archive dir absent" });
    return results;
  }
  const offenders = fs
    .readdirSync(ARCHIVE, { recursive: true })
    .filter((f) => String(f).endsWith(".md") && !String(f).endsWith("README.md"));
  results.push({
    name: "policy: .tasks/archive frozen (no task files added)",
    pass: offenders.length === 0,
    detail: offenders.length ? `task files added to frozen archive: ${offenders.join(", ")}` : "clean",
  });
  return results;
}

module.exports = { run };
