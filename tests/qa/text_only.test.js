'use strict';
// ATTACK 2 — Text-only enforcement: layer-item content must be plain text.
// data: URIs and base64 blobs (image/PDF payloads smuggled as strings) must
// be rejected with 400 via REST and via MCP add_layer_item.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { startMcp } = require('./helpers/mcp');
const { createBlueprint, addPhase, addStep, addLayerItemRaw, currentVersion, fixtureEntry } = require('./helpers/seed');

let api;
let server;
let mcp;
let bp1;
let stepId;

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF_DATA_URI = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCg==';
const RAW_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

before(async () => {
  server = await startServer({ entry: fixtureEntry() });
  api = server.request;
  bp1 = await createBlueprint(api, 'Text-only board', 'CURRENT_STATE');
  const phase = await addPhase(api, bp1.id, 'Discovery');
  const step = await addStep(api, bp1.id, { phase_id: phase.id, title: 'Shadowing' });
  stepId = step.id;
  mcp = await startMcp({ QA_SERVER_ENTRY: fixtureEntry(), BB_DB_PATH: require('node:path').join(server.dataDir, 'blueprints.db'), BB_NOTIFY_PORT: String(server.port) });
});

after(async () => {
  if (mcp) await mcp.stop();
  if (server) await server.stop();
});

test('REST: data:image URI content is rejected with 400', async () => {
  const res = await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: PNG_DATA_URI,
    version: await currentVersion(api, bp1.id),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
});

test('REST: data:application/pdf URI content is rejected with 400', async () => {
  const res = await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: PDF_DATA_URI,
    version: await currentVersion(api, bp1.id),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
});

test('REST: raw base64 blob content is rejected with 400', async () => {
  const res = await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: RAW_BASE64,
    version: await currentVersion(api, bp1.id),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
});

test('REST: plain text content still passes', async () => {
  const res = await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: 'Customer calls the helpdesk and waits on hold.',
    version: await currentVersion(api, bp1.id),
  });
  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${res.text}`);
});

test('MCP add_layer_item: data:image URI content errors with 400 semantics', async () => {
  const res = await mcp.callTool('add_layer_item', {
    blueprint_id: bp1.id,
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: PNG_DATA_URI,
  });
  assert.equal(res.ok, false, `expected tool error, got ok: ${JSON.stringify(res.result)}`);
  const errText = typeof res.error === 'string' ? res.error : JSON.stringify(res.error);
  assert.match(errText, /400/, `error must carry 400 semantics, got: ${errText}`);
});

test('MCP add_layer_item: raw base64 blob content errors with 400 semantics', async () => {
  const res = await mcp.callTool('add_layer_item', {
    blueprint_id: bp1.id,
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: RAW_BASE64,
  });
  assert.equal(res.ok, false, `expected tool error, got ok: ${JSON.stringify(res.result)}`);
  const errText = typeof res.error === 'string' ? res.error : JSON.stringify(res.error);
  assert.match(errText, /400/, `error must carry 400 semantics, got: ${errText}`);
});
