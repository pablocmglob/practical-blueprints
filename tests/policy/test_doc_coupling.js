"use strict";
/** Policy: doc coupling — a change to a guarded decision file with no change
 * to the behaviour docs or specs is refused. Compares last commit's changed
 * files; on the first commit (no HEAD~1) it passes vacuously. */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const GUARDED_DECISION = ["tools/validate.py", "tools/index.py", "schema/blueprints.schema.json"];
const BEHAVIOUR_DOCS = ["docs/BEHAVIOUR_REFERENCE.md", "docs/BEHAVIOUR_CHANGELOG.md"];

async function run() {
  const results = [];
  let changed;
  try {
    changed = execSync("git diff --name-only HEAD~1 HEAD", { encoding: "utf8", cwd: ROOT })
      .split(/\r?\n/).filter(Boolean);
  } catch {
    results.push({ name: "policy: doc coupling (no prior commit to compare)", pass: true, detail: "bootstrap" });
    return results;
  }
  const touchedDecision = changed.filter((f) => GUARDED_DECISION.some((g) => f.includes(g)));
  if (!touchedDecision.length) {
    results.push({ name: "policy: doc coupling for guarded decision files", pass: true, detail: "no decision file touched" });
    return results;
  }
  const touchedDocs = changed.filter((f) =>
    BEHAVIOUR_DOCS.some((d) => f.includes(d)) || f.includes(".specs/") || f.includes(".tasks/"));
  results.push({
    name: "policy: doc coupling (decision file change implies behaviour docs/specs change)",
    pass: touchedDocs.length > 0,
    detail: touchedDocs.length ? "" : `decision files ${touchedDecision.join(", ")} changed with no behaviour docs or specs update`,
  });
  return results;
}

module.exports = { run };
