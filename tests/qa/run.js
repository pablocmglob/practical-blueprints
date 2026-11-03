'use strict';
// QA suite runner: executes every attack test file with node --test.
// Usage: node tests/qa/run.js [--fixture]
//   --fixture  run against the noncompliant fixture (red-first proof).
//   default    run against the real server (server/index.js).
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/server');

const useFixture = process.argv.includes('--fixture');
const testFiles = [
  'state_gate.test.js',
  'contextual_export.test.js',
  'concurrency.test.js',
  'text_only.test.js',
  'sse_drift.test.js',
  'ui_overflow.test.js',
].map((f) => path.join(__dirname, f));

const env = { ...process.env };
if (useFixture) {
  env.QA_SERVER_ENTRY = path.join(__dirname, 'fixtures', 'noncompliant-server.js');
  env.QA_MCP_ENTRY = path.join(__dirname, 'fixtures', 'noncompliant-server.js');
}

const child = spawnSync(
  process.execPath,
  ['--test', ...testFiles],
  { cwd: REPO_ROOT, env, stdio: 'inherit' }
);
process.exit(child.status ?? 1);
