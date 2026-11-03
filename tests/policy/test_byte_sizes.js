"use strict";
/** Policy: AGENTS.md stays under ~24 KB; each rules file under 8 KB. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const RULES_DIR = path.join(ROOT, ".agents", "rules");
const MAX_CORE = 24 * 1024;
const MAX_RULE = 8 * 1024;

async function run() {
  const results = [];
  const core = path.join(ROOT, "AGENTS.md");
  const coreSize = fs.existsSync(core) ? fs.statSync(core).size : -1;
  results.push({
    name: "policy: AGENTS.md under 24 KB",
    pass: coreSize >= 0 && coreSize <= MAX_CORE,
    detail: coreSize < 0 ? "AGENTS.md missing" : `${coreSize} bytes (max ${MAX_CORE})`,
  });
  if (fs.existsSync(RULES_DIR)) {
    for (const f of fs.readdirSync(RULES_DIR).filter((f) => f.endsWith(".md"))) {
      const size = fs.statSync(path.join(RULES_DIR, f)).size;
      results.push({
        name: `policy: rules file .agents/rules/${f} under 8 KB`,
        pass: size <= MAX_RULE,
        detail: `${size} bytes (max ${MAX_RULE})`,
      });
    }
  }
  return results;
}

module.exports = { run };
