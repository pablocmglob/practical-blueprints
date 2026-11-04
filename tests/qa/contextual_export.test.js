'use strict';
// ATTACK 4 — Contextual export: export_action_plan must bundle, for every
// insight (CRITICAL_MOMENT / OPPORTUNITY / POTENTIAL_PITFALL), the parent
// step details AND all sibling layer items (Roles, Systems/Technology,
// Touchpoints, ...) attached to that same step.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const { startMcp } = require('./helpers/mcp');
const { createBlueprint, addPhase, addStep, addLayerItem, fixtureEntry } = require('./helpers/seed');

let api;
let server;
let mcp;
let bp1;
let stepHot;   // step holding a CRITICAL_MOMENT + siblings
let stepCold;  // step holding an OPPORTUNITY + siblings

before(async () => {
  server = await startServer({ entry: fixtureEntry() });
  api = server.request;
  bp1 = await createBlueprint(api, 'Export board', 'CURRENT_STATE');
  const phase = await addPhase(api, bp1.id, 'Service delivery');

  const s1 = await addStep(api, bp1.id, { phase_id: phase.id, title: 'Customer onboarding call' });
  stepHot = s1.id;
  await addLayerItem(api, bp1.id, { step_id: stepHot, layer_category: 'CRITICAL_MOMENT', content: 'Customer abandoned the call', version: bp1.version });
  await addLayerItem(api, bp1.id, { step_id: stepHot, layer_category: 'ROLE', content: 'Onboarding agent', version: bp1.version });
  await addLayerItem(api, bp1.id, { step_id: stepHot, layer_category: 'TECHNOLOGY', content: 'Legacy CRM', version: bp1.version });
  await addLayerItem(api, bp1.id, { step_id: stepHot, layer_category: 'TOUCHPOINT', content: 'Welcome call', version: bp1.version });

  const s2 = await addStep(api, bp1.id, { phase_id: phase.id, title: 'Renewal negotiation' });
  stepCold = s2.id;
  await addLayerItem(api, bp1.id, { step_id: stepCold, layer_category: 'OPPORTUNITY', content: 'Multi-year discount upsell', version: bp1.version });
  await addLayerItem(api, bp1.id, { step_id: stepCold, layer_category: 'POLICY', content: 'Discount approval matrix', version: bp1.version });

  mcp = await startMcp({ QA_SERVER_ENTRY: fixtureEntry(), DATA_DIR: server.dataDir });
});

after(async () => {
  if (mcp) await mcp.stop();
  if (server) await server.stop();
});

test('export_action_plan returns insights for both seeded steps', async () => {
  const res = await mcp.callTool('export_action_plan', { blueprint_id: bp1.id });
  assert.equal(res.ok, true, `expected success, got error: ${JSON.stringify(res.error)}`);
  const payload = typeof res.result === 'object' && res.result !== null && res.result.content
    ? res.result
    : res.text;
  const text = Array.isArray(payload.content) ? payload.content.map((c) => c.text || '').join('\n') : String(payload);
  const parsed = JSON.parse(text);
  const insights = parsed.insights || parsed;
  assert.ok(Array.isArray(insights) && insights.length >= 2, `expected >= 2 insights, got: ${text.slice(0, 300)}`);
});

test('each insight bundles parent step details', async () => {
  const res = await mcp.callTool('export_action_plan', { blueprint_id: bp1.id });
  const parsed = JSON.parse(Array.isArray(res.result.content) ? res.result.content.map((c) => c.text).join('\n') : res.text);
  const insights = parsed.insights || parsed;
  for (const insight of insights) {
    const step = insight.step || insight.parent_step || (insight.insight && insight.insight.step);
    assert.ok(step, `insight missing parent step: ${JSON.stringify(insight).slice(0, 300)}`);
    assert.ok(step.title, `parent step missing title: ${JSON.stringify(step).slice(0, 300)}`);
  }
});

test('each insight bundles ALL sibling layer items of its parent step', async () => {
  const res = await mcp.callTool('export_action_plan', { blueprint_id: bp1.id });
  const parsed = JSON.parse(Array.isArray(res.result.content) ? res.result.content.map((c) => c.text).join('\n') : res.text);
  const insights = parsed.insights || parsed;

  const hot = insights.find((i) => {
    const step = i.step || i.parent_step || (i.insight && i.insight.step);
    return step && (step.id === stepHot || step.title === 'Customer onboarding call');
  });
  assert.ok(hot, 'no insight found for the onboarding-call step');
  const hotBlob = JSON.stringify(hot);
  for (const sibling of ['Onboarding agent', 'Legacy CRM', 'Welcome call']) {
    assert.ok(hotBlob.includes(sibling), `insight for onboarding step missing sibling "${sibling}": ${hotBlob.slice(0, 500)}`);
  }

  const cold = insights.find((i) => {
    const step = i.step || i.parent_step || (i.insight && i.insight.step);
    return step && (step.id === stepCold || step.title === 'Renewal negotiation');
  });
  assert.ok(cold, 'no insight found for the renewal step');
  const coldBlob = JSON.stringify(cold);
  assert.ok(coldBlob.includes('Discount approval matrix'), `insight for renewal step missing sibling "Discount approval matrix": ${coldBlob.slice(0, 500)}`);
});
