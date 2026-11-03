"use strict";
/** Policy: functional commit subjects end with the task id, e.g. (T12) or
 * (T12+T13). Docs/chore/ci-only commits are exempt. Checks the last commit;
 * passes vacuously before the first commit. */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const EXEMPT = /^(docs|chore|ci|test\(policy\))(\(|:)/i;

async function run() {
  const results = [];
  let subject;
  try {
    subject = execSync("git log -1 --pretty=%s", { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    results.push({ name: "policy: commit subject carries task id (no commit yet)", pass: true, detail: "bootstrap" });
    return results;
  }
  const functional = !EXEMPT.test(subject);
  const hasId = /\((T\d+(?:\+T\d+)*)\)\s*$/.test(subject);
  results.push({
    name: "policy: functional commit subject ends with task id",
    pass: !functional || hasId,
    detail: functional && !hasId ? `subject "${subject}" lacks (T<id>)` : subject,
  });
  return results;
}

module.exports = { run };
