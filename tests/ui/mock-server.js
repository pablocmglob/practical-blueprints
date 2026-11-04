/* Mock backend for headless verification of the T3 canvas UI.
   Plain Node (no dependencies). Stubs the API contract the UI consumes:

   - GET  /api/blueprints
   - GET  /api/blueprints/{id}            (hierarchical JSON)
   - GET  /api/blueprints/{id}/events     (SSE stream)
   - POST /api/blueprints/{id}/layer-items  (If-Match required)

   Run:  node tests/ui/mock-server.js [port]     (default 8901)
   Serves ui/ at / so the full UI can be exercised in a browser too. */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 8901);
const UI_DIR = path.join(__dirname, '..', '..', 'ui');

const LAYER_CATEGORIES = [
  'TOUCHPOINT', 'ROLE', 'TECHNOLOGY', 'POLICY', 'PROCESS',
  'METRIC', 'CRITICAL_MOMENT', 'OPPORTUNITY', 'RATIONALE', 'POTENTIAL_PITFALL',
];

/* Synthetic blueprint: 3 phases / 12 steps with items in several cells. */
function makeBlueprint() {
  const phases = [];
  let stepCounter = 0;
  let itemCounter = 0;
  for (let p = 1; p <= 3; p++) {
    const steps = [];
    for (let s = 1; s <= 4; s++) {
      stepCounter += 1;
      const stepId = 'step-' + stepCounter;
      const items = [];
      // A few items per step, varying categories; step 2 of each phase is backstage.
      const itemCount = (stepCounter % 4) + 1;
      for (let i = 0; i < itemCount; i++) {
        itemCounter += 1;
        items.push({
          id: 'item-' + itemCounter,
          layer_category: LAYER_CATEGORIES[(stepCounter + i) % LAYER_CATEGORIES.length],
          content: 'Sample note ' + itemCounter + ' for ' + stepId,
        });
      }
      steps.push({
        id: stepId,
        name: 'Step ' + stepCounter,
        is_visible: stepCounter % 2 === 1, // odd = frontstage
        layer_items: items,
      });
    }
    phases.push({ id: 'phase-' + p, name: 'Phase ' + p, steps: steps });
  }
  return {
    id: 'bp-mock',
    name: 'Mock Customer Onboarding Blueprint',
    version: 7,
    phases: phases,
  };
}

const state = {
  blueprint: makeBlueprint(),
  version: 7,
  eventLog: [],
  sseClients: [],
};

function broadcast(event) {
  state.eventLog.push(event);
  const payload = 'data: ' + JSON.stringify(event) + '\n\n';
  state.sseClients.forEach(function (res) { res.write(payload); });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let data = '';
    req.on('data', function (chunk) {
      data += chunk;
      if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', function () { resolve(data); });
    req.on('error', reject);
  });
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // ---- API ----
  if (pathname === '/api/blueprints' && req.method === 'GET') {
    return sendJson(res, 200, [{ id: state.blueprint.id, name: state.blueprint.name }]);
  }

  const bpMatch = pathname.match(/^\/api\/blueprints\/([^/]+)$/);
  if (bpMatch && req.method === 'GET') {
    return sendJson(res, 200, state.blueprint);
  }

  const eventsMatch = pathname.match(/^\/api\/blueprints\/([^/]+)\/events$/);
  if (eventsMatch && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: ' + JSON.stringify({ type: 'hello', version: state.version }) + '\n\n');
    state.sseClients.push(res);
    req.on('close', function () {
      state.sseClients = state.sseClients.filter(function (c) { return c !== res; });
    });
    return;
  }

  const itemsMatch = pathname.match(/^\/api\/blueprints\/([^/]+)\/layer-items$/);
  if (itemsMatch && req.method === 'POST') {
    const ifMatch = req.headers['if-match'];
    if (!ifMatch || Number(ifMatch) !== state.version) {
      return sendJson(res, 412, { error: 'version mismatch (expected If-Match: ' + state.version + ')' });
    }
    return readBody(req).then(function (body) {
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) {
        return sendJson(res, 400, { error: 'invalid JSON' });
      }
      if (!parsed || !parsed.step_id || LAYER_CATEGORIES.indexOf(parsed.layer_category) === -1 ||
          typeof parsed.content !== 'string' || parsed.content.trim() === '') {
        return sendJson(res, 422, { error: 'step_id, valid layer_category and non-empty text content required' });
      }
      const item = {
        id: 'item-' + (state.eventLog.length + 1000),
        layer_category: parsed.layer_category,
        content: parsed.content,
      };
      let targetStep = null;
      state.blueprint.phases.forEach(function (phase) {
        phase.steps.forEach(function (step) {
          if (step.id === parsed.step_id) targetStep = step;
        });
      });
      if (!targetStep) return sendJson(res, 404, { error: 'unknown step_id: ' + parsed.step_id });
      targetStep.layer_items.push(item);
      state.version += 1;
      state.blueprint.version = state.version;
      const event = { type: 'layer_item.created', step_id: parsed.step_id, item_id: item.id, version: state.version };
      broadcast(event);
      return sendJson(res, 201, { id: item.id, version: state.version });
    });
  }

  // ---- Static files from ui/ ----
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^([/\\])+/, '');
  const absolute = path.join(UI_DIR, filePath);
  if (!absolute.startsWith(UI_DIR)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(absolute, function (err, data) {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(absolute);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, function () {
    console.log('mock server on http://localhost:' + PORT + ' (serving ui/)');
  });
}

module.exports = { server: server, state: state, makeBlueprint: makeBlueprint, LAYER_CATEGORIES: LAYER_CATEGORIES };
