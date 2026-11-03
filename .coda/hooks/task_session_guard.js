#!/usr/bin/env node
/**
 * task_session_guard.js — PreToolUse hook on Edit/Write.
 * Blocks the FIRST edit of a session until the session has written/claimed
 * an internal task in .tasks/ (marker file .coda/tmp/task-session-ok).
 * FAILS OPEN on any internal error. On-the-record bypass: create
 * .coda/tmp/task-bypass.txt containing a reason; the bypass is logged.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.cwd());
const MARKER = path.join(ROOT, ".coda", "tmp", "task-session-ok");
const BYPASS = path.join(ROOT, ".coda", "tmp", "task-bypass.txt");

function main() {
  try {
    if (fs.existsSync(MARKER)) { ok(); return; }
    if (fs.existsSync(BYPASS)) {
      const reason = fs.readFileSync(BYPASS, "utf8").trim();
      fs.appendFileSync(path.join(ROOT, ".coda", "tmp", "task-bypass.log"),
        `${new Date().toISOString()} bypass: ${reason}\n`);
      ok(); return;
    }
    // Fail open if .tasks does not exist yet (fresh repo bootstrap).
    if (!fs.existsSync(path.join(ROOT, ".tasks"))) { ok(); return; }
    console.log(JSON.stringify({
      decision: "block",
      reason: "task-session guard: no task claimed this session. Create/claim a task file in .tasks/ first (see .agents/rules/task-specs.md). On-the-record bypass: write the reason to .coda/tmp/task-bypass.txt.",
    }));
  } catch {
    ok(); // fail open
  }
}

function ok() { console.log(JSON.stringify({ decision: "approve" })); }

main();
