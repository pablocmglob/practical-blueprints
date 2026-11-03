'use strict';
// ATTACK 5 — SSE drift: a change injected via the MCP add_layer_item tool
// must reach every connected SSE subscriber WITHOUT a refresh. If a UI client
// has to poll or reload to see agent-injected changes, that is drift.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { startMcp } = require('./helpers/mcp');
const { createBlueprint, addPhase, addStep, fixtureEntry } = require('./helpers/seed');

let api;
let server;
let mcp;
let bp1;
let stepId;

before(async () => {
  server = await startServer({ entry: fixtureEntry() });
  api = server.request;
  bp1 = await createBlueprint(api, 'Drift board', 'CURRENT_STATE');
  const phase = await addPhase(api, bp1.id, 'Support');
  const step = await addStep(api, bp1.id, { phase_id: phase.id, title: 'Ticket triage' });
  stepId = step.id;
  mcp = await startMcp({ QA_SERVER_ENTRY: fixtureEntry(), DATA_DIR: server.dataDir });
});

after(async () => {
  if (mcp) await mcp.stop();
  if (server) await server.stop();
});

test('MCP add_layer_item pushes an SSE event to connected subscribers', async () => {
  const sse = await server.openSse(`/api/blueprints/${bp1.id}/events`, { want: 1, collectMs: 5000 });

  const res = await mcp.callTool('add_layer_item', {
    blueprint_id: bp1.id,
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: 'agent-injected via MCP',
  });
  assert.equal(res.ok, true, `MCP write failed: ${JSON.stringify(res.error)}`);

  // Wait briefly for the push, then inspect what arrived.
  await new Promise((r) => setTimeout(r, 500));
  const events = sse.events;
  sse.close();

  assert.ok(events.length >= 1, 'no SSE event received after MCP add_layer_item');
  const blob = JSON.stringify(events);
  assert.ok(
    blob.includes('agent-injected via MCP') || blob.includes('layer_item'),
    `SSE event does not reference the MCP-injected item: ${blob.slice(0, 500)}`
  );
});

test('MCP-injected item is visible via GET without any refresh side channel', async () => {
  const res = await mcp.callTool('add_layer_item', {
    blueprint_id: bp1.id,
    step_id: stepId,
    layer_category: 'ROLE',
    content: 'second agent-injected role',
  });
  assert.equal(res.ok, true, `MCP write failed: ${JSON.stringify(res.error)}`);

  const board = await api('GET', `/api/blueprints/${bp1.id}`);
  assert.equal(board.status, 200);
  const blob = JSON.stringify(board.json);
  assert.ok(blob.includes('second agent-injected role'), 'MCP-injected item not visible via GET');
});
