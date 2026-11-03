#!/usr/bin/env node
/**
 * routine_runner_guard.js — PreToolUse hook carried by the routine-runner
 * agent. Deny-by-default; exact command shapes only; no shell
 * metacharacters; Edit allowed on exactly one named file (env
 * ROUTINE_ALLOWED_FILE or the single file named in the job). FAILS CLOSED.
 */
"use strict";

const ALLOWED_COMMAND_SHAPES = [
  /^node tools\/gen_agents\.py --write$/,
  /^node tools\/gen_agents\.py --check$/,
  /^node tools\/run_tests\.py( [^\s*&|;`$<>\\"]+)?$/,
  /^git (status|diff|log)( --[a-z-]+)*$/,
];

function hasMetachars(s) {
  return /[;&|`$><\\\n]|\$\(|\|\|/.test(s);
}

function main() {
  let input = {};
  try { input = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { /* fallthrough */ }
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};

  if (tool === "Edit" || tool === "edit") {
    const file = String(ti.file_path || ti.path || "").replace(/\\/g, "/");
    const allowed = process.env.ROUTINE_RUNNER_ALLOWED_FILE
      ? process.env.ROUTINE_RUNNER_ALLOWED_FILE.replace(/\\/g, "/")
      : null;
    if (allowed && file.endsWith(allowed)) { approve(); return; }
    block(`routine-runner guard: Edit allowed only on the one named file (${allowed || "none"}).`);
    return;
  }

  if (tool === "Bash" || tool === "bash") {
    const cmd = String((input.tool_input || {}).command || "").trim();
    if (ALLOWED_COMMAND_SHAPE(cmd)) { approve(); return; }
    block(`routine-runner guard: command not in allowlist: ${cmd}`);
    return;
  }

  block(`routine-runner guard: tool ${tool} not allowed (deny-by-default).`);
}

function ALLOWED_COMMAND_SHAPE(cmd) {
  if (hasMetachars(cmd)) return false;
  return ALLOWED_COMMAND_SHAPES.some((re) => re.test(cmd));
}

function approve() { console.log(JSON.stringify({ decision: "approve" })); }
function block(reason) { console.log(JSON.stringify({ decision: "block", reason })); }

const input = (() => {
  try { return JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { return {}; }
})();
main(input);
