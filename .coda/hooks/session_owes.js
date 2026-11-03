#!/usr/bin/env node
/**
 * session_owes.js — SessionStart / Stop hook.
 * Reports what the session owes the task tracker: unclaimed work in flight,
 * tasks left in the wrong state, uncommitted changes at Stop.
 * Non-blocking: prints a report; the harness surfaces it.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.cwd());

function main(phase) {
  const lines = [];
  try {
    const inFlight = path.join(ROOT, ".tasks", "IN_FLIGHT.md");
    if (fs.existsSync(inFlight)) {
      const text = fs.readFileSync(inFlight, "utf8");
      const inProgress = (text.match(/State:\s*In Progress/g) || []).length;
      if (phase === "stop" && inProgress > 0) {
        lines.push(`session-owes: ${inProgress} task(s) still In Progress — move them to the right state before ending.`);
      }
    }
    const todo = fs.existsSync(path.join(ROOT, ".tasks"))
      ? fs.readdirSync(path.join(ROOT, ".tasks")).filter((f) => /^task-.*\.md$/.test(f)).length
      : 0;
    if (phase === "start") {
      lines.push(`task tracker: ${todo} task file(s) at root of .tasks/ — read .tasks/IN_FLIGHT.md and claim before working.`);
    }
    if (phase === "stop") {
      const { execSync } = require("child_process");
      const dirty = execSync("git status --porcelain", { encoding: "utf8", cwd: ROOT }).trim();
      if (dirty) lines.push("session-owes: uncommitted changes — everything lives in the repo; commit before you stop.");
    }
  } catch { /* non-blocking */ }
  console.log(lines.length ? lines.join("\n") : `session-owes: nothing owed (${phase}).`);
}

main((process.argv[2] || "start").toLowerCase());
