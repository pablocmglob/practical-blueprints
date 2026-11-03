"use strict";
/** Policy: published-specs marker — when specs changed, the task tracker must
 * reflect it (a .tasks/ file references the spec change). Red first: the rule
 * (task-specs topic) existed before this test. */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

async function run() {
  const results = [];
  let changed;
  try {
    changed = execSync("git diff --name-only HEAD~1 HEAD", { encoding: "utf8", cwd: ROOT })
      .split(/\r?\n/).filter(Boolean);
  } catch {
    results.push({ name: "policy: specs published to tracker (bootstrap)", pass: true, detail: "bootstrap" });
    return results;
  }
  const specsChanged = changed.filter((f) => f.includes(".specs/"));
  if (!specsChanged.length) {
    results.push({ name: "policy: specs changed implies tracker reflects it", pass: true, detail: "no specs changed" });
    return results;
  }
  const tasksDir = path.join(ROOT, ".tasks");
  const taskText = fs.existsSync(tasksDir)
    ? JSON.stringify(fs.readdirSync(tasksDir, { recursive: true }).map((f) => {
        try { return fs.readFileSync(path.join(tasksDir, String(f)), "utf8"); } catch { return ""; }
      }))
    : "";
  const specIds = specsChanged.map((f) => f.split("/")[1]).filter(Boolean);
  const reflected = specIds.some((id) => taskText.includes(id));
  results.push({
    name: "policy: specs changed implies task tracker reflects it",
    pass: reflected,
    detail: reflected ? "" : `specs ${specIds.join(", ")} changed with no tracker reference`,
  });
  return results;
}

module.exports = { run };
