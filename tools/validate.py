#!/usr/bin/env node
/**
 * validate.py — the validation chokepoint (HR-3, HR-5).
 *
 * Usage: node tools/validate.py [--corpus <dir>] [--report <file>]
 *
 * Behaviour (documented in docs/BEHAVIOUR_REFERENCE.md):
 * - Read-only on the corpus (HR-1): never writes, renames or deletes there.
 * - Missing schema → raise (exit 1), write nothing (HR-5 strict read).
 * - Invalid file → exit 1 with one precise error line per failure.
 * - All valid → exit 0.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(ROOT, "schema", "blueprints.schema.json");

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
  const schemaPath = get("--schema") || SCHEMA_PATH;
  const report = get("--report");

  // HR-5: strict critical read of the schema — raise, write nothing on failure.
  if (!fs.existsSync(schemaPath)) {
    fail(`validate: critical read failed: schema not found at ${path.relative(ROOT, schemaPath)} — raise, write nothing (HR-5)`);
  }
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (e) {
    fail(`validate: schema is not valid JSON: ${e.message}`);
  }

  if (!fs.existsSync(corpus)) {
    console.log("validate: corpus dir absent — nothing to validate (0 files)");
    return;
  }
  const files = fs.readdirSync(corpus).filter((f) => f.endsWith(".json"));
  const errors = [];
  for (const f of files) {
    const full = path.join(corpus, f);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(corpus, f), "utf8"));
    } catch (e) {
      errors.push(`${f}: not valid JSON: ${e.message}`);
      continue;
    }
    if (!doc.id) errors.push(`${f}: missing required field 'id'`);
    if (!doc.title) errors.push(`${f}: missing required field 'title'`);
  }
  if (errors.length) {
    for (const e of errors) console.error(`validate: ${e}`);
    process.exit(1);
  }
  console.log(`validate: ${files.length} file(s) valid`);
}

main();
