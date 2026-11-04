'use strict';
// ATTACK 1 — State gate: a state-specific layer category must never land on a
// blueprint whose state_type forbids it. CRITICAL_MOMENT is current-state
// only; RATIONALE is future-state only. Attacked via REST and via MCP
// add_layer_item. Contract: blocked with 400 semantics (REST 400 / JSON-RPC
// error carrying "400").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { startMcp } = require('./helpers/mcp');
const { createBlueprint, addPhase, addStep, addLayerItemRaw, fixtureEntry } = require('./helpers/seed');

let api;
let server;
let mcp;
let futureBp; // {id, version}
let futureStepId;
let currentBp;
let currentStepId;

before(async () => {
  server = await startServer({ entry: fixtureEntry() });
  api = server.request;

  futureBp = await createBlueprint(api, 'Future board', 'FUTURE_STATE');
  const phase = await addPhase(api, futureBp.id, 'Delivery');
  const step = await addStep(api, futureBp.id, { phase_id: phase.id, title: 'Handover' });
  futureStepId = step.id;

  currentBp = await createBlueprint(api, 'Current board', 'CURRENT_STATE');
  const phase2 = await addPhase(api, currentBp.id, 'Discovery');
  const step2 = await addStep(api, currentBp.id, { phase_id: phase2.id, title: 'Interviews' });
  currentStepId = step2.id;

  mcp = await startMcp({ QA_SERVER_ENTRY: fixtureEntry(), DATA_DIR: server.dataDir });
});

after(async () => {
  if (mcp) await mcp.stop();
  if (server) await server.stop();
});

test('REST: CRITICAL_MOMENT on FUTURE_STATE is blocked with 400', async () => {
  const res = await addLayerItemRaw(api, futureBp.id, {
    step_id: futureStepId,
    layer_category: 'CRITICAL_MOMENT',
    content: 'moment of truth',
    version: futureBp.version,
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
});

test('REST: RATIONALE on CURRENT_STATE is blocked with 400', async () => {
  const res = await addLayerItemRaw(api, currentBp.id, {
    step_id: currentStepId,
    layer_category: 'RATIONALE',
    content: 'why we change',
    version: currentBp.version,
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
});

test('REST: POTENTIAL_PITFALL on CURRENT_STATE is blocked with 400', async () => {
  const res = await addLayerItemRaw(api, currentBp.id, {
    step_id: currentStepId,
    layer_category: 'POTENTIAL_PITFALL',
    content: 'pitfall',
    version: currentBp.version,
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
});

test('REST: valid categories pass on matching state', async () => {
  const okFuture = await addLayerItemRaw(api, futureBp.id, {
    step_id: futureStepId,
    layer_category: 'RATIONALE',
    content: 'valid rationale',
    version: futureBp.version,
  });
  assert.equal(okFuture.status, 201, `expected 201, got ${okFuture.status}: ${okFuture.text}`);

  const okCurrent = await addLayerItemRaw(api, currentBp.id, {
    step_id: currentStepId,
    layer_category: 'CRITICAL_MOMENT',
    content: 'valid critical moment',
    version: currentBp.version,
  });
  assert.equal(okCurrent.status, 201, `expected 201, got ${okCurrent.status}: ${okCurrent.text}`);
});

test('MCP add_layer_item: CRITICAL_MOMENT on FUTURE_STATE errors with 400 semantics', async () => {
  const res = await mcp.callTool('add_layer_item', {
    blueprint_id: futureBp.id,
    step_id: futureStepId,
    layer_category: 'CRITICAL_MOMENT',
    content: 'agent-injected critical moment',
  });
  assert.equal(res.ok, false, `expected tool error, got ok: ${JSON.stringify(res.result)}`);
  const errText = typeof res.error === 'string' ? res.error : JSON.stringify(res.error);
  assert.match(errText, /400/, `error must carry 400 semantics, got: ${errText}`);
});

test('MCP add_layer_item: valid category on matching state succeeds', async () => {
  const res = await mcp.callTool('add_layer_item', {
    blueprint_id: futureBp.id,
    step_id: futureStepId,
    layer_category: 'POTENTIAL_PITFALL',
    content: 'agent-injected pitfall',
  });
  assert.equal(res.ok, true, `expected success, got error: ${JSON.stringify(res.error)}`);
});
