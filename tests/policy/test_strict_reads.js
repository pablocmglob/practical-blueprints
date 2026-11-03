"use strict";
/** L1: HR-5 strict critical reads — a failed read of a critical fact raises
 * and writes nothing; it never falls back to a default silently. Executes
 * tools/validate.py against a corpus with a missing schema (throwaway dir). */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const NODE = process.execPath;

async function run() {
  const results = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bb-strict-${process.pid}-`));
  const corpus = path.join(dir, "blueprints");
  fs.mkdirSync(corpus);
  fs.writeFileSync(path.join(corpus, "bp.json"), JSON.stringify({ id: "bp", title: "T" }));
  // No schema → critical read of the schema must raise, write nothing.
  const outPath = path.join(dir, "should-not-exist.txt");
  let raised = false;
  try {
    execFileSync(NODE, [path.join(ROOT, "tools", "validate.py"), "--corpus", corpus, "--schema", path.join(dir, "absent.schema.json"), "--report", outPath], { encoding: "utf8" });
  } catch {
    raised = true;
  }
  results.push({
    name: "L1: HR-5 missing schema raises (strict critical read)",
    pass: raised && !fs.existsSync(outPath),
    detail: raised ? "raised as required" : "validate.py did not raise on missing schema",
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return results;
}

module.exports = { run };
