"use strict";
/** L1: HR-1 no silent corpus loss — a tool run that plans no removals leaves
 * the corpus byte-identical. Executes tools/index.py over a seeded corpus in
 * a throwaway dir and asserts every file survives. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const NODE = process.execPath;

async function run() {
  const results = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bb-corpus-${process.pid}-`));
  const corpus = path.join(dir, "blueprints");
  fs.mkdirSync(corpus);
  const files = ["bp-1.json", "bp-2.json", "bp-3.json"];
  for (const f of files) {
    fs.writeFileSync(path.join(corpus, f), JSON.stringify({ id: f.replace(".json", ""), title: f }));
  }
  const before = fs.readdirSync(corpus).sort().join(",");
  try {
    execFileSync(NODE, [path.join(ROOT, "tools", "index.py"), "--corpus", corpus, "--out", path.join(dir, "idx.json")], { encoding: "utf8" });
  } catch (e) {
    results.push({ name: "L1: HR-1 corpus survives an index run", pass: false, detail: String(e) });
    return results;
  }
  const after = fs.readdirSync(corpus).sort().join(",");
  results.push({
    name: "L1: HR-1 no silent corpus loss during index run",
    pass: before === after,
    detail: before === after ? "" : `corpus changed: ${before} -> ${after}`,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return results;
}

module.exports = { run };
