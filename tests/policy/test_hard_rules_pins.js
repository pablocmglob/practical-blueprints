"use strict";
/** Policy: Hard Rules text pins (L1). The five HR statements in
 * docs/HARD_RULES_HISTORY.md are guarded decisions: this test pins their
 * headings and their "Locked by" regression tests, so a weakening edit
 * (dropping a rule, renaming its lock) fails the gate instead of passing
 * silently. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DOC = path.join(ROOT, "docs", "HARD_RULES_HISTORY.md");

const HR_HEADINGS = [
  "## HR-1 — No silent corpus loss",
  "## HR-2 — Single writer per fact",
  "## HR-3 — Validation is a chokepoint",
  "## HR-4 — Idempotent, additive index writes",
  "## HR-5 — Strict critical reads",
];

const HR_LOCKS = [
  ["HR-1", "tests/policy/test_corpus_integrity.js"],
  ["HR-2", "tests/policy/test_ssot_pins.js"],
  ["HR-3", "tests/policy/test_ssot_pins.js"],
  ["HR-4", "tests/policy/test_index_idempotent.js"],
  ["HR-5", "tests/policy/test_strict_reads.js"],
];

async function run() {
  const results = [];
  let text = "";
  try {
    text = fs.readFileSync(DOC, "utf8");
  } catch (err) {
    return [
      {
        name: "policy: hard rules history readable",
        pass: false,
        detail: `cannot read docs/HARD_RULES_HISTORY.md: ${err.message}`,
      },
    ];
  }

  // Pin 1: every HR heading exists verbatim (a dropped or renamed rule fails).
  for (const heading of HR_HEADINGS) {
    results.push({
      name: `policy: hard rule pin: "${heading}" present`,
      pass: text.includes(heading),
      detail: text.includes(heading) ? "" : `heading missing from HARD_RULES_HISTORY.md`,
    });
  }

  // Pin 2: each rule cites its regression test, and that test file exists.
  for (const [rule, testPath] of HR_LOCKS) {
    const cited = text.includes(`\`${testPath}\``);
    results.push({
      name: `policy: hard rule pin: ${rule} locked by ${testPath}`,
      pass: cited,
      detail: cited ? "" : `${rule} no longer cites ${testPath}`,
    });
    const abs = path.join(ROOT, ...testPath.split("/"));
    const exists = fs.existsSync(abs);
    results.push({
      name: `policy: hard rule pin: ${rule} lock file exists`,
      pass: exists,
      detail: exists ? "" : `cited lock ${testPath} does not exist on disk`,
    });
  }

  // Pin 3: the guarded-decision list in AGENTS.md still names the history doc
  // (the doc-coupling guard only protects files it lists).
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  results.push({
    name: "policy: hard rule pin: HARD_RULES_HISTORY.md is a guarded decision file",
    pass: agents.includes("HARD_RULES_HISTORY.md"),
    detail: agents.includes("HARD_RULES_HISTORY.md")
      ? ""
      : "AGENTS.md no longer lists docs/HARD_RULES_HISTORY.md as guarded",
  });

  return results;
}

module.exports = { run };
