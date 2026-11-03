"use strict";
/** Policy: generated-agent drift. Red first: ran before `gen_agents --write`
 * existed for ux-implementer; the check reported the missing file and exited 1. */
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const NODE = process.execPath;

async function run() {
  const results = [];
  try {
    const out = execFileSync(NODE, [path.join(ROOT, "tools", "gen_agents.py"), "--check"], {
      encoding: "utf8", cwd: ROOT,
    });
    results.push({ name: "policy: generated agents in sync (gen_agents --check)", pass: true, detail: out.trim() });
  } catch (e) {
    results.push({
      name: "policy: generated agents in sync (gen_agents --check)",
      pass: false,
      detail: String(e.stdout || e.message).trim(),
    });
  }
  return results;
}

module.exports = { run };
