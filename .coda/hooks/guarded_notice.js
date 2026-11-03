#!/usr/bin/env node
/**
 * guarded_notice.js — PreToolUse hook on Edit/Write.
 * NON-BLOCKING notice when the touched file is on the guarded list.
 * Input (stdin): JSON {tool_input: {file_path}}.
 * Fails open: any error → approve.
 */
"use strict";

const GUARDED = [
  "blueprints/",
  "tools/validate.py",
  "tools/index.py",
  "schema/blueprints.schema.json",
  "tests/smoke_test.py",
  "docs/BEHAVIOUR_REFERENCE.md",
  "docs/BEHAVIOUR_CHANGELOG.md",
];

function main() {
  try {
    const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const file = (input.tool_input && (input.tool_input.file_path || input.tool_input.path)) || "";
    const norm = String(file).replace(/\\/g, "/");
    if (GUARDED.some((g) => norm.includes(g))) {
      console.log(JSON.stringify({
        decision: "approve",
        reason: `GUARDED FILE: ${norm} triggers the full protocol (PRE snapshot, behaviour reference, Hard-Rule audit, docs update). See AGENTS.md §2.`,
      }));
      return;
    }
  } catch { /* fail open */ }
  console.log(JSON.stringify({ decision: "approve" }));
}

main();
