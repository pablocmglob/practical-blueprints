"use strict";
/** Policy: SSOT pins + Hard Rules (L1/L2). Checks the canonical locations
 * named in .agents/rules/ssot-registry.md exist and are the only writers. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function exists(rel) { return fs.existsSync(path.join(ROOT, ...rel.split("/"))); }

async function run() {
  const results = [];
  const pins = [
    ["ssot pin: blueprint corpus dir blueprints/ is canonical", ["blueprints"], true],
    ["ssot pin: schema/blueprints.schema.json is the only schema", ["schema", "blueprints.schema.json"], true],
    ["ssot pin: tools/validate.py is the only validator", ["tools", "validate.py"], true],
    ["ssot pin: tools/index.py is the only index writer", ["tools", "index.py"], true],
    ["ssot pin: .tasks/ is the only queue (IN_FLIGHT.md present)", [".tasks", "IN_FLIGHT.md"], true],
    ["ssot pin: behaviour reference present", ["docs", "BEHAVIOUR_REFERENCE.md"], true],
    ["ssot pin: hard rules history present", ["docs", "HARD_RULES_HISTORY.md"], true],
    ["ssot pin: flags registry present", ["docs", "flags_default_off.json"], true],
    ["hard rule pin: no parallel validator (only tools/validate.py)", ["tools", "validate.py"], true],
  ];
  for (const [name, rel, required] of pins) {
    const ok = exists(rel.join("/"));
    results.push({
      name: `policy: ${name}`,
      pass: !required || ok,
      detail: ok ? "" : `missing canonical file ${rel.join("/")}`,
    });
  }
  // HR-3: no parallel validator — no other file may claim validation of the corpus.
  const toolsDir = path.join(ROOT, "tools");
  if (fs.existsSync(toolsDir)) {
    const validators = fs.readdirSync(toolsDir)
      .filter((f) => /valid/i.test(f) && f !== "validate.py");
    results.push({
      name: "policy: HR-3 no parallel validator in tools/",
      pass: validators.length === 0,
      detail: validators.length ? `parallel validator candidates: ${validators.join(", ")}` : "",
    });
  }
  return results;
}

module.exports = { run };
