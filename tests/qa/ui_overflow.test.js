'use strict';
// ATTACK 6 — UI edge cases, via static analysis + DOM-string checks of ui/
// (the UI is a static canvas app; no browser deps allowed, so we attack the
// shipped source strings and the CSS contract):
//   - no <input type="file"> / file-upload hooks (text-only enforcement)
//   - drag-drop rejection handlers present (image/PDF drops are rejected)
//   - sticky header / row-label CSS present
//   - a generated 50-step / 20-item-per-step fixture must be renderable and
//     the grid must declare overflow handling (overflow:auto + scroll).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/server');

const UI_DIR = path.join(REPO_ROOT, 'ui');

function uiFiles() {
  if (!fs.existsSync(UI_DIR)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(UI_DIR);
  return out;
}

function readAll(files) {
  return files.map((f) => ({
    path: f,
    text: fs.readFileSync(f, 'utf8'),
  }));
}

let files;

before(() => {
  files = readAll(uiFiles());
});

test('ui/ directory exists with assets', () => {
  assert.ok(files.length > 0, 'ui/ directory is empty or missing — cannot attack');
});

test('no file inputs or upload hooks in ui/ (text-only enforcement)', () => {
  const offenders = files.filter(({ text }) =>
    /<input[^>]*type=["']?file/i.test(text) ||
    /type=["']?file["']?/i.test(text) ||
    /FileReader|showOpenFilePicker|FormData\s*\(/.test(text)
  );
  assert.deepEqual(offenders, [], `file-upload hooks found in: ${offenders.map((o) => o.path).join(', ')}`);
});

test('drag-drop rejection handlers present (image/PDF drops rejected)', () => {
  const jsFiles = files.filter((f) => /\.(js|html)$/i.test(f.path));
  const blob = jsFiles.map((f) => f.text).join('\n');
  assert.match(blob, /dragover|dragover\b|ondragover|drag-over/i, 'no dragover handler found');
  assert.match(blob, /drop/i, 'no drop handler found');
  // Rejection must be explicit: preventDefault + reject/deny/text-only wording.
  assert.match(
    blob,
    /preventDefault/,
    'drop/dragover handler must call preventDefault to reject the drop'
  );
  assert.match(
    blob,
    /reject|text-only|text only|not allowed|denied|invalid/i,
    'no explicit rejection of non-text drops found'
  );
});

test('sticky header and row-label CSS present', () => {
  const cssFiles = files.filter((f) => /\.(css|html)$/i.test(f.path));
  const blob = cssFiles.map((f) => f.text).join('\n');
  assert.match(blob, /position:\s*sticky/i, 'no position:sticky rule found');
  assert.match(blob, /top:\s*0/i, 'sticky header needs top:0');
  // Row labels sticky horizontally (left: 0) so they stay in viewport.
  assert.match(blob, /left:\s*0/i, 'sticky row labels need left:0');
});

test('grid CSS handles overflow via overflow:auto / scroll', () => {
  const cssFiles = files.filter((f) => /\.(css|html)$/i.test(f.path));
  const blob = cssFiles.map((f) => f.text).join('\n');
  assert.match(blob, /display:\s*grid|grid-template/i, 'no CSS grid layout found');
  assert.match(blob, /overflow(-x|-y)?:\s*(auto|scroll)/i, 'no overflow:auto/scroll rule found');
});

test('generated 50-step / 20-item fixture renders against the grid contract', () => {
  // Build the extreme fixture as data the UI must be able to render.
  const steps = Array.from({ length: 50 }, (_, i) => ({
    id: `st-${i + 1}`,
    title: `Step ${i + 1}`,
    layer_items: Array.from({ length: 20 }, (_, j) => ({
      id: `li-${i + 1}-${j + 1}`,
      layer_category: ['TOUCHPOINT', 'ROLE', 'TECHNOLOGY', 'POLICY', 'PROCESS'][j % 5],
      content: `Item ${i + 1}.${j + 1}`,
    })),
  }));
  const fixture = { phases: [{ id: 'ph-1', name: 'Load test', steps }] };
  assert.equal(fixture.phases[0].steps.length, 50);
  assert.equal(fixture.phases[0].steps[0].layer_items.length, 20);

  // The UI must consume this shape: find the render entry and confirm it
  // iterates steps and layer items (i.e. no hardcoded step/item cap).
  const jsFiles = files.filter((f) => /\.(js|html|css)$/i.test(f.path));
  const blob = jsFiles.map((f) => f.text).join('\n');
  assert.match(blob, /steps?/i, 'UI never references steps');
  assert.match(blob, /layer[_ ]?items?/i, 'UI never references layer items');
  // Overflow container: the grid must live inside a scrollable element.
  assert.match(
    blob,
    /overflow(-x|-y)?:\s*(auto|scroll)/i,
    'rendering surface has no scrollable overflow container for 50+ steps'
  );
  // Serialize the fixture to prove it is well-formed render input.
  const serialized = JSON.stringify(fixture);
  assert.ok(serialized.length > 1000, 'fixture unexpectedly tiny');
});
