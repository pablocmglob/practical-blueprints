"use strict";
/** Policy: schema drift (L3/L7). The schema file must be valid JSON; corpus
 * files (when present) must declare the canonical schema. Bootstrap: the
 * schema may be a stub. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCHEMA = path.join(ROOT, "schema", "blueprints.schema.json");
const CORPUS = path.join(ROOT, "blueprints");

async function run() {
  const results = [];
  if (!fs.existsSync(SCHEMA)) {
    results.push({ name: "policy: schema file exists", pass: false, detail: "schema/blueprints.schema.json missing" });
    return results;
  }
  try {
    JSON.parse(fs.readFileSync(SCHEMA, "utf8"));
    results.push({ name: "policy: schema file parses as JSON", pass: true });
  } catch (e) {
    results.push({ name: "policy: schema file parses as JSON", pass: false, detail: String(e) });
    return results;
  }

  if (fs.existsSync(CORPUS)) {
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith(".json") || f.endsWith(".md"));
    for (const f of files) {
      const text = fs.readFileSync(path.join(CORPUS, f), "utf8");
      const declares = text.includes("blueprints.schema.json");
      results.push({
        name: `policy: corpus file ${f} declares the canonical schema`,
        pass: declares,
        detail: declares ? "" : "no $schema reference to the canonical schema",
      });
    }
  }
  return results;
}

module.exports = { run };
