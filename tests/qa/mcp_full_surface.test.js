'use strict';
// T5 — Full MCP editing surface: every action performable by the web UI must
// be exposed as an MCP tool. Contract: tools/list returns the full surface;
// each tool executes against the live DB (seed → call → read back → assert),
// uses the shared validators, bumps the blueprint version, and reaches SSE
// subscribers via the notify bridge.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { startMcp } = require('./helpers/mcp');
const { createBlueprint, addPhase, addStep, currentVersion, fixtureEntry } = require('./helpers/seed');

let api;
let server;
let mcp;

before(async () => {
  server = await startServer({ entry: fixtureEntry() });
  api = server.request;
  mcp = await startMcp({
    QA_SERVER_ENTRY: fixtureEntry(),
    BB_DB_PATH: require('node:path').join(server.dataDir, 'blueprints.db'),
    BB_NOTIFY_PORT: String(server.port),
  });
});

after(async () => {
  if (mcp) await mcp.stop();
  if (server) await server.stop();
});

function payload(res) {
  return JSON.parse(res.result.content[0].text);
}

/* ---------- tool surface ---------- */

test('tools/list exposes the full editing surface', async () => {
  const tools = await mcp.listTools();
  const names = new Set(tools.map((t) => t.name));
  const REQUIRED = [
    // existing
    'get_blueprint_schema', 'add_layer_item', 'export_action_plan',
    // blueprint lifecycle
    'list_blueprints', 'create_blueprint', 'delete_blueprint',
    // phases
    'create_phase', 'update_phase', 'delete_phase',
    // steps
    'create_step', 'update_step', 'delete_step',
    // layer items
    'update_layer_item', 'delete_layer_item',
    // ordering
    'reorder_steps',
  ];
  for (const name of REQUIRED) {
    assert.ok(names.has(name), `missing MCP tool '${name}'`);
  }
});

/* ---------- blueprint lifecycle ---------- */

test('MCP create_blueprint → visible over REST; list_blueprints finds it', async () => {
  const created = await mcp.callTool('create_blueprint', {
    name: 'MCP-created board',
    state_type: 'CURRENT_STATE',
  });
  assert.ok(created.ok, `tool ran: ${JSON.stringify(created.error)}`);
  const { blueprint } = payload(created);
  assert.ok(blueprint.id > 0, 'returns the created blueprint');
  assert.equal(blueprint.state_type, 'CURRENT_STATE');

  const listed = await mcp.callTool('list_blueprints', {});
  const names = payload(listed).map((b) => b.name);
  assert.ok(names.includes('MCP-created board'), 'list_blueprints sees it');
});

test('MCP delete_blueprint erases the blueprint (REST 404 after)', async () => {
  const bp = await createBlueprint(api, 'Doomed', 'CURRENT_STATE');
  const res = await mcp.callTool('delete_blueprint', { blueprint_id: bp.id });
  assert.ok(res.ok, `tool ran: ${JSON.stringify(res.error)}`);
  const after = await api('GET', `/api/blueprints/${bp.id}`);
  assert.equal(after.status, 404, 'blueprint gone over REST');
});

/* ---------- phases ---------- */

test('MCP create_phase / update_phase / delete_phase round-trip', async () => {
  const bp = await createBlueprint(api, 'Phase round-trip', 'FUTURE_STATE');

  const created = await mcp.callTool('create_phase', { blueprint_id: bp.id, name: 'P1' });
  assert.ok(created.ok, `create_phase ran: ${JSON.stringify(created.error)}`);
  const { phase, version } = payload(created);
  assert.ok(phase.id > 0, 'phase created');

  const updated = await mcp.callTool('update_phase', { blueprint_id: bp.id, phase_id: phase.id, name: 'P1-renamed' });
  assert.ok(updated.ok, `update_phase ran: ${JSON.stringify(updated.error)}`);

  const hierarchy = await api('GET', `/api/blueprints/${bp.id}`);
  const names = hierarchy.json.phases.map((p) => p.name);
  assert.ok(names.includes('P1-renamed'), 'rename visible over REST');
  assert.ok(Number(hierarchy.headers.etag) > version, 'version bumped');

  const del = await mcp.callTool('delete_phase', { blueprint_id: bp.id, phase_id: phase.id });
  assert.ok(del.ok, 'delete_phase ran');
  const after = await api('GET', `/api/blueprints/${bp.id}`);
  assert.equal(after.json.phases.length, 0, 'phase erased');
});

/* ---------- steps ---------- */

test('MCP create_step / update_step / delete_step round-trip', async () => {
  const bp = await createBlueprint(api, 'Step round-trip', 'CURRENT_STATE');
  const phase = await addPhase(api, bp.id, 'P1');

  const created = await mcp.callTool('create_step', {
    blueprint_id: bp.id, phase_id: phase.id, title: 'S1',
  });
  assert.ok(created.ok, 'create_step ran');
  const { step } = payload(created);
  assert.ok(step.id > 0, 'step created');

  const updated = await mcp.callTool('update_step', {
    blueprint_id: bp.id, step_id: step.id, title: 'S1-renamed', is_visible: false,
  });
  assert.ok(updated.ok, 'update_step ran');
  const after = await api('GET', `/api/blueprints/${bp.id}`);
  const s = after.json.phases[0].steps[0];
  assert.equal(s.title, 'S1-renamed', 'title patched');
  assert.equal(s.is_visible, 0, 'visibility toggled');

  const del = await mcp.callTool('delete_step', { blueprint_id: bp.id, step_id: step.id });
  assert.ok(del.ok, 'delete_step ran');
  const afterDel = await api('GET', `/api/blueprints/${bp.id}`);
  assert.equal(afterDel.json.phases[0].steps.length, 0, 'step erased');
});

/* ---------- layer items ---------- */

test('MCP update_layer_item / delete_layer_item round-trip', async () => {
  const bp = await createBlueprint(api, 'Item round-trip', 'CURRENT_STATE');
  const phase = await addPhase(api, bp.id, 'P1');
  const step = await addStep(api, bp.id, { phase_id: phase.id, title: 'S1' });

  const added = await mcp.callTool('add_layer_item', {
    step_id: step.id, layer_category: 'TOUCHPOINT', content: 'v1',
  });
  assert.ok(added.ok, 'add_layer_item ran');
  const { layer_item: item } = payload(added);

  const upd = await mcp.callTool('update_layer_item', {
    blueprint_id: bp.id, layer_item_id: item.id, content: 'v2',
  });
  assert.ok(upd.ok, `update_layer_item ran: ${JSON.stringify(upd.error)}`);
  const after = await api('GET', `/api/blueprints/${bp.id}`);
  const content = after.json.phases[0].steps[0].layer_items[0].content;
  assert.equal(content, 'v2', 'content patched');

  const del = await mcp.callTool('delete_layer_item', {
    blueprint_id: bp.id, layer_item_id: item.id,
  });
  assert.ok(del.ok, 'delete_layer_item ran');
  const afterDel = await api('GET', `/api/blueprints/${bp.id}`);
  assert.equal(afterDel.json.phases[0].steps[0].layer_items.length, 0, 'item erased');
});

/* ---------- ordering ---------- */

test('MCP reorder_steps reorders steps within a phase', async () => {
  const bp = await createBlueprint(api, 'Reorder via MCP', 'CURRENT_STATE');
  const phase = await addPhase(api, bp.id, 'P1');
  const s1 = await addStep(api, bp.id, { phase_id: phase.id, title: 'A' });
  const s2 = await addStep(api, bp.id, { phase_id: phase.id, title: 'B' });

  const res = await mcp.callTool('reorder_steps', {
    blueprint_id: bp.id,
    steps: [{ id: s1.id, display_order: 1 }, { id: s2.id, display_order: 0 }],
  });
  assert.ok(res.ok, `reorder ran: ${JSON.stringify(res.error)}`);
  const hierarchy = await api('GET', `/api/blueprints/${bp.id}`);
  const titles = hierarchy.json.phases[0].steps.map((s) => s.title);
  assert.deepEqual(titles, ['B', 'A'], 'order applied');
});

/* ---------- shared gates ---------- */

test('MCP state gate: add_layer_item with wrong category is blocked', async () => {
  const bp = await createBlueprint(api, 'Gate board', 'CURRENT_STATE');
  const phase = await addPhase(api, bp.id, 'P1');
  const step = await addStep(api, bp.id, { phase_id: phase.id, title: 'S1' });
  const res = await mcp.callTool('add_layer_item', {
    step_id: step.id, layer_category: 'RATIONALE', content: 'blocked',
  });
  assert.ok(!res.ok, 'blocked');
  assert.match(String(res.error && res.error.message), /400/, 'carries 400 semantics');
});

test('MCP text-only gate: data URI content is rejected', async () => {
  const bp = await createBlueprint(api, 'Text gate', 'CURRENT_STATE');
  const phase = await addPhase(api, bp.id, 'P1');
  const step = await addStep(api, bp.id, { phase_id: phase.id, title: 'S1' });
  const res = await mcp.callTool('add_layer_item', {
    step_id: step.id, layer_category: 'TOUCHPOINT', content: 'data:image/png;base64,AAAA',
  });
  assert.ok(!res.ok, 'blocked');
});
