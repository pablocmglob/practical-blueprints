'use strict';
// ATTACK 3 — Concurrency: two racing mutations on the same step, one carrying
// a stale If-Match version. Contract: the stale write MUST get 409 (no silent
// overwrite), a retry with the fresh version succeeds, and concurrent SSE
// subscribers receive both events.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { createBlueprint, addPhase, addStep, addLayerItemRaw, fixtureEntry } = require('./helpers/seed');

let api;
let server;
let bp1;
let stepId;

before(async () => {
  server = await startServer({ entry: fixtureEntry() });
  api = server.request;
  bp1 = await createBlueprint(api, 'Race board', 'CURRENT_STATE');
  const phase = await addPhase(api, bp1.id, 'Delivery');
  const step = await addStep(api, bp1.id, { phase_id: phase.id, title: 'Contested step' });
  stepId = step.id;
});

after(async () => {
  if (server) await server.stop();
});

test('racing mutations: stale If-Match gets 409, fresh retry succeeds', async () => {
  // Two writers both read version 1, then race.
  const staleVersion = bp1.version; // 1
  const writeA = addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'TOUCHPOINT',
    content: 'writer A (fresh)',
    version: staleVersion,
  });
  const writeB = addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'ROLE',
    content: 'writer B (stale)',
    version: staleVersion,
  });
  const [resA, resB] = await Promise.all([writeA, writeB]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [201, 409], `expected one 201 and one 409, got ${resA.status}/${resB.status}: ${resA.text} | ${resB.text}`);

  // Retry the loser with the fresh version: must succeed.
  const winner = resA.status === 201 ? resA : resB;
  const freshVersion = winner.json.version;
  const retry = await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'ROLE',
    content: 'writer B retry with fresh version',
    version: freshVersion,
  });
  assert.equal(retry.status, 201, `retry with fresh version must succeed, got ${retry.status}: ${retry.text}`);
});

test('explicitly stale If-Match is rejected with 409 (no silent overwrite)', async () => {
  const current = await server.request('GET', `/api/blueprints/${bp1.id}`);
  const version = current.json.version;
  // First write bumps the version.
  const first = await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'POLICY',
    content: 'first write',
    version,
  });
  assert.equal(first.status, 201);
  // Second write reuses the OLD version -> must 409.
  const second = await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'POLICY',
    content: 'stale write that must not land',
    version, // stale now
  });
  assert.equal(second.status, 409, `expected 409 for stale If-Match, got ${second.status}: ${second.text}`);

  // The stale content must NOT be in the blueprint.
  const after = await server.request('GET', `/api/blueprints/${bp1.id}`);
  const allItems = JSON.stringify(after.json);
  assert.ok(!allItems.includes('stale write that must not land'), 'stale write silently landed');
});

test('concurrent SSE clients both receive events from racing mutations', async () => {
  const sseA = await server.openSse(`/api/blueprints/${bp1.id}/events`, { want: 2, collectMs: 5000 });
  const sseB = await server.openSse(`/api/blueprints/${bp1.id}/events`, { want: 2, collectMs: 5000 });

  const version = (await server.request('GET', `/api/blueprints/${bp1.id}`)).json.version;
  await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'PROCESS',
    content: 'sse event one',
    version,
  });
  const version2 = (await server.request('GET', `/api/blueprints/${bp1.id}`)).json.version;
  await addLayerItemRaw(api, bp1.id, {
    step_id: stepId,
    layer_category: 'TECHNOLOGY',
    content: 'sse event two',
    version: version2,
  });

  // Give the server a moment to flush, then collect.
  await new Promise((r) => setTimeout(r, 500));
  const collectedA = sseA.events;
  const collectedB = sseB.events;
  sseA.close();
  sseB.close();

  assert.ok(collectedA.length >= 2, `SSE client A got ${collectedA.length} events, expected >= 2`);
  assert.ok(collectedB.length >= 2, `SSE client B got ${collectedB.length} events, expected >= 2`);
  const blobA = JSON.stringify(collectedA);
  assert.ok(blobA.includes('sse event one') && blobA.includes('sse event two'), `client A events missing payloads: ${blobA}`);
  const blobB = JSON.stringify(collectedB);
  assert.ok(blobB.includes('sse event one') && blobB.includes('sse event two'), `client B events missing payloads: ${blobB}`);
});
