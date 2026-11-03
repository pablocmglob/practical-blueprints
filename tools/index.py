#!/usr/bin/env node
/**
 * index.py — the only writer of the published index (HR-4, HR-5).
 *
 * Usage: node tools/index.py [--corpus <dir>] [--out <file>]
 *
 * Behaviour (documented in docs/BEHAVIOUR_REFERENCE.md):
 * - Idempotent: same corpus → same bytes.
 * - Additive: never deletes entries not covered by the current corpus (HR-4).
 * - Duplicate ids → raise, write nothing (HR-5).
 * - Empty corpus → writes an empty index (valid state).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  const get = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const corpus = get("--corpus") || path.join(ROOT, "blueprints");
  const out = get("--out") || path.join(ROOT, "index", "blueprints.json");

  if (!fs.existsSync(corpus)) {
    fail(`index: critical read failed: corpus dir not found: ${corpus} — raise, write nothing (HR-5)`);
  }
  const files = fs.readdirSync(corpus).filter((f) => f.endsWith(".json")).sort();
  const entries = [];
  const seen = new Set();
  for (const f of files) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(corpus, f), "utf8"));
    } catch (e) {
      fail(`index: ${f} is not valid JSON: ${e.message} — write nothing (HR-5)`);
    }
    if (!doc.id) fail(`index: ${f} missing 'id' — raise, write nothing (HR-5)`);
    if (seen.has(doc.id)) {
      fail(`index: duplicate id '${doc.id}' in corpus — raise, write nothing (HR-5)`);
    }
    seen.add(doc.id);
    entries.push({ id: doc.id, title: doc.title || "", file: f });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const payload = JSON.stringify({ generated_by: "tools/index.py", blueprints: entries }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, payload);
  console.log(`index: ${entries.length} blueprint(s) indexed -> ${out}`);
}

main();
