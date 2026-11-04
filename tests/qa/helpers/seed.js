'use strict';
// Shared seeding helpers: build a blueprint hierarchy over the REST contract.
const path = require('node:path');
const { REPO_ROOT } = require('./server');

const FIXTURE_ENTRY = path.join(REPO_ROOT, 'tests', 'qa', 'fixtures', 'noncompliant-server.js');
const REAL_ENTRY = path.join(REPO_ROOT, 'server', 'index.js');

// Default: attack the REAL server. The fixture is opt-in via QA_SERVER_ENTRY
// (set by run.js --fixture for red-first proof).
function fixtureEntry() {
  return process.env.QA_SERVER_ENTRY || REAL_ENTRY;
}

// POST /api/blueprints {name, state_type} -> {id, version}
async function createBlueprint(api, name, stateType) {
  const res = await api('POST', '/api/blueprints', {
    body: { name, state_type: stateType },
  });
  if (res.status !== 201) {
    throw new Error(`createBlueprint failed: ${res.status} ${res.text}`);
  }
  return res.json;
}

// Fetch the blueprint's current version (ETag) so helpers always send a
// fresh If-Match.
async function currentVersion(api, blueprintId) {
  const res = await api('GET', `/api/blueprints/${blueprintId}`);
  if (res.status !== 200) throw new Error(`currentVersion failed: ${res.status} ${res.text}`);
  return Number(res.headers.etag) || (res.json && res.json.version) || 1;
}

async function addPhase(api, blueprintId, name) {
  const version = await currentVersion(api, blueprintId);
  const res = await api('POST', `/api/blueprints/${blueprintId}/phases`, {
    body: { name },
    headers: { 'If-Match': String(version) },
  });
  if (res.status !== 201) throw new Error(`addPhase failed: ${res.status} ${res.text}`);
  return res.json.phase;
}

async function addStep(api, blueprintId, { phase_id, title, is_visible = true }) {
  const version = await currentVersion(api, blueprintId);
  const res = await api('POST', `/api/blueprints/${blueprintId}/steps`, {
    body: { phase_id, title, is_visible },
    headers: { 'If-Match': String(version) },
  });
  if (res.status !== 201) throw new Error(`addStep failed: ${res.status} ${res.text}`);
  return res.json.step;
}

// Layer item creation honouring If-Match. Returns the raw response.
function addLayerItemRaw(api, blueprintId, { step_id, layer_category, content, version }) {
  return api('POST', `/api/blueprints/${blueprintId}/layer-items`, {
    body: { step_id, layer_category, content },
    headers: version !== undefined ? { 'If-Match': String(version) } : {},
  });
}

async function addLayerItem(api, blueprintId, opts) {
  const res = await addLayerItemRaw(api, blueprintId, opts);
  if (res.status !== 201) throw new Error(`addLayerItem failed: ${res.status} ${res.text}`);
  return res.json;
}

async function getBlueprint(api, blueprintId) {
  const res = await api('GET', `/api/blueprints/${blueprintId}`);
  if (res.status !== 200) throw new Error(`getBlueprint failed: ${res.status} ${res.text}`);
  return res.json;
}

module.exports = {
  createBlueprint,
  addPhase,
  addStep,
  addLayerItem,
  addLayerItemRaw,
  getBlueprint,
  currentVersion,
  fixtureEntry,
};
