#!/usr/bin/env node
/**
 * secret_scan.js — PreToolUse hook on git commit.
 * Scans staged files for secret-looking patterns; blocks the commit on a hit.
 * Input (stdin): JSON {tool_input: {command}} from the harness.
 * Output: JSON {decision: "block"|"approve", reason} — block fails the call.
 */
"use strict";

const { execSync } = require("child_process");

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bghp_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, "generic api key (sk-)"],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, "JWT"],
  [/password\s*=\s*['\"][^'\"]{8,}['\"]/i, "hardcoded password"],
  [/api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9_-]{16,}['\"]/i, "hardcoded api key"],
];

function main() {
  let input = "";
  try { input = require("fs").readFileSync(0, "utf8"); } catch { /* no stdin */ }
  let staged = [];
  try {
    staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
      .split(/\r?\n/).filter(Boolean);
  } catch (e) {
    // fail open: cannot list staged files
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }
  for (const f of staged) {
    let content = "";
    try { content = execSync(`git show ":${f}"`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }); }
    catch { continue; }
    for (const [re, label] of PATTERNS) {
      if (re.test(f)) { continue; } // filename itself matching is fine
      if (re.test(content)) {
        console.log(JSON.stringify({
          decision: "block",
          reason: `secret scan: ${label} detected in staged file ${f}. Remove it before committing.`,
        }));
        return;
      }
    }
  }
  console.log(JSON.stringify({ decision: "approve" }));
}

main();
