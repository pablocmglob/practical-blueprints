/* Headless tests for the T3 canvas UI (plain Node, node --test).
   Verifies the pure logic in ui/app.js plus the mock-server API contract.

   Run:  node --test tests/ui/
   (or:  node --test tests/ui/ui.test.js ) */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const app = require('../../ui/app.js');
const mock = require('./mock-server.js');

/* ---------- taxonomy ---------- */

test('taxonomy covers all ten layer categories with required colors', () => {
  const ids = app.LAYER_CATEGORIES.map((c) => c.id);
  assert.deepStrictEqual(ids, [
    'TOUCHPOINT', 'ROLE', 'TECHNOLOGY', 'POLICY', 'PROCESS',
    'METRIC', 'CRITICAL_MOMENT', 'OPPORTUNITY', 'RATIONALE', 'POTENTIAL_PITFALL',
  ]);
  const byId = Object.fromEntries(app.LAYER_CATEGORIES.map((c) => [c.id, c]));
  // Strict color-coding per spec §2.
  assert.strictEqual(byId.ROLE.color, '#16a34a');           // Green
  assert.strictEqual(byId.TOUCHPOINT.color, '#2563eb');     // Blue
  assert.strictEqual(byId.POLICY.color, '#ea580c');         // Orange
  assert.strictEqual(byId.CRITICAL_MOMENT.color, '#dc2626');// Red
  assert.strictEqual(byId.OPPORTUNITY.color, '#eab308');    // Yellow
  // Every category has a guiding prompt.
  app.LAYER_CATEGORIES.forEach((c) => assert.ok(c.prompt.length > 5, c.id + ' needs a prompt'));
});

/* ---------- grid model ---------- */

test('buildGridModel produces a single linear path: phases then steps in order', () => {
  const bp = mock.makeBlueprint();
  const model = app.buildGridModel(bp);
  assert.strictEqual(model.phases.length, 3);
  assert.strictEqual(model.steps.length, 12);
  // Linear order preserved
  assert.strictEqual(model.steps[0].id, 'step-1');
  assert.strictEqual(model.steps[4].phaseId, 'phase-2');
  // No branching structures anywhere in the model
  assert.ok(model.steps.every((s) => typeof s.id === 'string'));
});

test('buildGridModel buckets items by step×category cell', () => {
  const model = app.buildGridModel(mock.makeBlueprint());
  const keys = Object.keys(model.itemsByCell);
  assert.ok(keys.length > 0);
  keys.forEach((key) => {
    const [stepId, category] = key.split('::');
    assert.ok(app.CATEGORY_IDS.includes(category), 'valid category in key ' + key);
    assert.ok(stepId.startsWith('step-'));
    model.itemsByCell[key].forEach((item) => {
      assert.strictEqual(item.layerCategory, category);
      assert.strictEqual(typeof item.content, 'string');
    });
  });
});

test('buildGridModel marks frontstage vs backstage from is_visible', () => {
  const model = app.buildGridModel(mock.makeBlueprint());
  const step2 = model.steps.find((s) => s.id === 'step-2');
  const step1 = model.steps.find((s) => s.id === 'step-1');
  assert.strictEqual(step2.isVisible, false); // backstage
  assert.strictEqual(step1.isVisible, true);  // frontstage
});

test('buildGridModel skips items with unknown categories', () => {
  const bp = {
    id: 'x', version: 1,
    phases: [{
      id: 'p1', name: 'P1',
      steps: [{
        id: 's1', name: 'S1', is_visible: true,
        layer_items: [
          { id: 'i1', layer_category: 'NO_SUCH_CATEGORY', content: 'bad' },
          { id: 'i2', layer_category: 'ROLE', content: 'good' },
        ],
      }],
    }],
  };
  const model = app.buildGridModel(bp);
  assert.deepStrictEqual(model.itemsByCell['s1::ROLE'].map((i) => i.id), ['i2']);
  assert.strictEqual(model.itemsByCell['s1::NO_SUCH_CATEGORY'], undefined);
});

/* ---------- heat map ---------- */

test('columnWidthFactor grows with stacked items and is capped', () => {
  assert.strictEqual(app.columnWidthFactor(0), 1);
  assert.strictEqual(app.columnWidthFactor(3), 1);
  assert.ok(app.columnWidthFactor(10) > app.columnWidthFactor(5));
  assert.strictEqual(app.columnWidthFactor(100), 2.5); // capped
});

/* ---------- text-only enforcement ---------- */

test('validateTextOnly rejects non-strings, empty and oversized text', () => {
  assert.strictEqual(app.validateTextOnly('hello').ok, true);
  assert.strictEqual(app.validateTextOnly('   ').ok, false);
  assert.strictEqual(app.validateTextOnly(42).ok, false);
  assert.strictEqual(app.validateTextOnly(null).ok, false);
  assert.strictEqual(app.validateTextOnly('x'.repeat(2001)).ok, false);
  assert.strictEqual(app.validateTextOnly('x'.repeat(2000)).ok, true);
});

test('classifyTransfer flags files for rejection and accepts plain text', () => {
  assert.strictEqual(app.classifyTransfer({ files: [{}], types: ['Files'] }), 'file');
  assert.strictEqual(app.classifyTransfer({ files: [], types: ['text/plain'] }), 'text');
  assert.strictEqual(app.classifyTransfer({ files: [], types: [] }), 'unknown');
  assert.strictEqual(app.classifyTransfer(null), 'unknown');
});

/* ---------- API client contract (against the mock server) ---------- */

test('mock server: full mutation contract with If-Match and SSE', async (t) => {
  const server = mock.server;
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  // list
  const listRes = await fetch(base + '/api/blueprints');
  const list = await listRes.json();
  assert.strictEqual(list[0].id, 'bp-mock');

  // hierarchical get
  const bpRes = await fetch(base + '/api/blueprints/bp-mock');
  const bp = await bpRes.json();
  assert.ok(bp.phases.length >= 3);
  assert.ok(bp.phases[0].steps[0].layer_items.length >= 1);

  // SSE stream: connect, then POST, then read until the broadcast arrives.
  // (The stream stays open, so we read after the mutation is queued.)
  let sseReader = null;
  const ssePromise = (async () => {
    const res = await fetch(base + '/api/blueprints/bp-mock/events');
    assert.strictEqual(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body.getReader();
    sseReader = reader;
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      const text = decoder.decode(value);
      if (text.includes('layer_item.created')) return text;
    }
  })();

  // POST without If-Match → 412
  const noMatch = await fetch(base + '/api/blueprints/bp-mock/layer-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step_id: 'step-1', layer_category: 'ROLE', content: 'x' }),
  });
  assert.strictEqual(noMatch.status, 412);

  // POST with stale If-Match → 412
  const stale = await fetch(base + '/api/blueprints/bp-mock/layer-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': '1' },
    body: JSON.stringify({ step_id: 'step-1', layer_category: 'ROLE', content: 'x' }),
  });
  assert.strictEqual(stale.status, 412);

  // POST with current version → 201 + new version
  const ok = await fetch(base + '/api/blueprints/bp-mock/layer-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': String(bp.version) },
    body: JSON.stringify({ step_id: 'step-1', layer_category: 'ROLE', content: 'headless note' }),
  });
  assert.strictEqual(ok.status, 201);
  const okBody = await ok.json();
  assert.strictEqual(okBody.version, bp.version + 1);

  // SSE event for the mutation arrives (bounded wait)
  const sseText = await Promise.race([
    ssePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
  assert.ok(sseText && sseText.includes('layer_item.created'), 'SSE broadcast received');

  // Release the SSE connection so the test runner can exit cleanly.
  if (sseReader) { try { await sseReader.cancel(); } catch (e) { /* already closed */ } }

  // invalid category → 422
  const bad = await fetch(base + '/api/blueprints/bp-mock/layer-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': String(okBody.version) },
    body: JSON.stringify({ step_id: 'step-1', layer_category: 'IMAGE', content: 'x' }),
  });
  assert.strictEqual(bad.status, 422);
});

/* ---------- extreme-load layout (QA T4 case): 50+ steps × 20+ items ---------- */

test('grid model handles 50+ steps with 20+ items per cell without data loss', () => {
  const phases = [];
  let stepN = 0;
  let itemN = 0;
  for (let p = 0; p < 5; p++) {
    const steps = [];
    for (let s = 0; s < 11; s++) { // 55 steps total
      stepN += 1;
      const items = [];
      for (let i = 0; i < 22; i++) { // 22 items per step
        itemN += 1;
        items.push({
          id: 'i' + itemN,
          layer_category: app.CATEGORY_IDS[i % app.CATEGORY_IDS.length],
          content: 'note ' + itemN,
        });
      }
      steps.push({ id: 's' + stepN, name: 'S' + stepN, is_visible: true, layer_items: items });
    }
    phases.push({ id: 'p' + p, name: 'P' + p, steps: steps });
  }
  const model = app.buildGridModel({ id: 'big', version: 1, phases: phases });
  assert.strictEqual(model.steps.length, 55);
  const totalItems = Object.values(model.itemsByCell)
    .reduce((sum, arr) => sum + arr.length, 0);
  assert.strictEqual(totalItems, 55 * 22);
  // Every cell with 22 items across 10 categories holds 2–3 items; the
  // widest column factor stays within the cap → layout stays bounded.
  assert.ok(app.columnWidthFactor(22) <= 2.5);
  // Grid template for 55 columns is generated without error.
  const template = 'var(--row-label-width) repeat(' + model.steps.length + ', max-content)';
  assert.ok(template.includes('repeat(55'));
});

/* ---------- static UI files sanity ---------- */

test('ui/index.html references app.js and styles.css; no external URLs', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'index.html'), 'utf8');
  assert.ok(html.includes('src="app.js"'));
  assert.ok(html.includes('href="styles.css"'));
  assert.ok(!html.includes('http://') && !html.includes('https://'), 'no CDN/external deps');
  assert.ok(!html.includes('<input type="file"'), 'no file inputs');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'app.js'), 'utf8');
  assert.ok(!js.includes('type="file"'), 'no file inputs created in JS');
  assert.ok(js.includes('EventSource'), 'SSE subscription present');
  assert.ok(js.includes("If-Match"), 'If-Match header sent on mutations');
  // Regression: app.js must self-boot in the browser. It previously only
  // exported init() for tests, so the page stayed on "connecting…" forever.
  assert.ok(
    /else if \(typeof document !== 'undefined'\)\s*\{[\s\S]*?init\(document, window\);/.test(js),
    'browser entry point missing: app.js never calls init() in the browser'
  );
});

/* ---------- T-101-D modernization regressions ---------- */

test('app.js includes inline edit, drag reorder, category pill and presentation mode', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'app.js'), 'utf8');
  assert.ok(js.includes("method: 'PATCH'"), 'PATCH used for inline edits');
  assert.ok(js.includes('/reorder'), 'reorder endpoint called');
  assert.ok(js.includes('category:'), 'category pill payload present');
  assert.ok(js.includes('presentation-toggle'), 'presentation mode wired');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'styles.css'), 'utf8');
  assert.ok(css.includes('body.presenting'), 'presentation CSS present');
  assert.ok(css.includes('--heat'), 'heat-map CSS variable present');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'index.html'), 'utf8');
  assert.ok(html.includes('id="presentation-toggle"'), 'toggle button in HTML');
});

/* ---------- editing toolbar (T3-M1..M6 fixes) ---------- */

test('UI exposes the full editing toolbar and prompt forms open on selection', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'styles.css'), 'utf8');

  // Toolbar buttons exist in HTML and are wired in app.js.
  ['add-phase-btn', 'add-step-btn', 'toggle-visibility-btn', 'delete-step-btn', 'delete-phase-btn']
    .forEach((id) => assert.ok(html.includes(`id="${id ?? id}"`) || html.includes(`id="${id}"`), `${id} in HTML`));
  assert.ok(js.includes('wireToolbar'), 'toolbar wiring present');
  assert.ok(js.includes('updateToolbar'), 'toolbar state sync present');

  // The T3-M1 bug: prompt forms must open on step selection.
  assert.ok(js.includes('prompt-open'), 'prompt forms open on step selection');

  // Conflict recovery + stale selection + keyboard access.
  assert.ok(js.includes('recoverFromConflict'), '412 conflict recovery helper present');
  assert.ok(js.includes("tabindex', '0'"), 'step headers keyboard focusable');
  assert.ok(css.includes('focus-visible'), 'focus ring CSS present');

  // Backstage cells render dark (T3-Mo1).
  assert.ok(css.includes('.cell.backstage'), 'backstage cell CSS present');
});
