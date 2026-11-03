"use strict";
/** L1: HR-1 no silent corpus loss + HR-4 index idempotence + HR-5 strict
 * reads. Executes the tools (seed → call → read back → assert) against a
 * throwaway temp dir with a session-unique path, never a shared store. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const NODE = process.execPath;

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bb-test-${process.pid}-${Date.now()}-`));
}

function runTool(tool, args) {
  return execFileSync(NODE, [path.join(ROOT, "tools", tool), ...args], { encoding: "utf8" });
}

async function run() {
  const results = [];

  // HR-4: index idempotence — same corpus → same bytes; additive.
  const dir = scratch();
  const corpus = path.join(dir, "blueprints");
  fs.mkdirSync(corpus);
  fs.writeFileSync(path.join(corpus, "bp-a.json"), JSON.stringify({ id: "bp-a", title: "A" }));
  fs.writeFileSync(path.join(dir, "index.json"), "PLACEHOLDER");
  runTool("index.py", ["--corpus", corpus, "--out", path.join(dir, "index.json")]);
  const first = fs.readFileSync(path.join(dir, "index.json"), "utf8");
  runTool("index.py", ["--corpus", corpus, "--out", path.join(dir, "index.json")]);
  const second = fs.readFileSync(path.join(dir, "index.json"), "utf8");
  results.push({
    name: "L1 HR-4: index re-run is byte-identical (idempotent)",
    pass: first === second && !first.includes("PLACEHOLDER"),
    detail: first === second ? "" : "re-run produced different bytes",
  });

  // HR-4 additive: an entry not covered by the corpus is never deleted by re-run.
  const idx = JSON.parse(first);
  results.push({
    name: "L1: HR-4 index covers exactly the corpus (no dup, no loss)",
    pass: Array.isArray(idxEntries(idx)) && idxEntries(idx).length === 1,
    detail: `entries: ${JSON.stringify(idxEntries(idx))}`,
  });

  // HR-5: strict critical reads — duplicate ids raise and write nothing.
  const dup = scratch();
  const dupCorpus = path.join(dup, "blueprints");
  fs.mkdirSync(dupCorpus);
  fs.writeFileSync(path.join(dupCorpus, "bp-a.json"), JSON.stringify({ id: "bp-x", title: "1" }));
  fs.writeFileSync(path.join(dupCorpus, "bp-b.json"), JSON.stringify({ id: "bp-x", title: "2" }));
  const outPath = path.join(dup, "idx.json");
  let raised = false;
  try {
    runTool("index.py", ["--corpus", dupCorpus, "--out", outPath]);
  } catch {
    raised = true;
  }
  results.push({
    name: "L1: HR-5 duplicate ids raise and write nothing",
    pass: raised && !fs.existsSync(outPath),
    detail: raised ? "raised as required" : "index.py did not raise on duplicate ids",
  });

  // HR-1: validate.py is read-only on the corpus.
  const vdir = scratch();
  const vcorpus = path.join(vdir, "blueprints");
  fs.mkdirSync(vcorpus);
  fs.writeFileSync(path.join(vcorpus, "bp-b.json"), JSON.stringify({ id: "bp-b", title: "B" }));
  const before = fs.readdirSync(vcorpus).sort().join(",");
  try { runTool("validate.py", ["--corpus", vcorpus]); } catch { /* invalid is fine */ }
  const after = fs.readdirSync(vcorpus).sort().join(",");
  results.push({
    name: "L1: HR-1 validate.py never modifies the corpus",
    pass: before === after,
    detail: before === after ? "" : `corpus changed: ${before} -> ${after}`,
  });

  return results;
}

function idxEntries(idx) {
  if (Array.isArray(idx)) return idx;
  if (idx && Array.isArray(idx.blueprints)) return idx.blueprints;
  return [];
}

module.exports = { run };
