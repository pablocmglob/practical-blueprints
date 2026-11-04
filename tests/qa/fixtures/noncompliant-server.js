'use strict';
// NON-COMPLIANT fixture server — deliberately violates the backend contract
// so the QA suite can be proven red-first. It implements just enough of the
// REST + MCP contract to be attackable:
//
//   VIOLATION 1 (state gate): accepts ANY layer_category on ANY state_type
//     (e.g. CRITICAL_MOMENT on FUTURE_STATE) — no 400.
//   VIOLATION 2 (concurrency): ignores If-Match entirely; a stale write
//     silently overwrites instead of returning 409.
//   VIOLATION 3 (text-only): accepts data: URIs / base64 blobs as content.
//   VIOLATION 4 (SSE drift): SSE endpoint exists but never emits events.
//   VIOLATION 5 (contextual export): export_action_plan returns insights
//     WITHOUT sibling layer items.
//
// This file is a test fixture only. It is NOT the real server and must never
// be imported by production code.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 0);
const HOST = process.env.HOST || '127.0.0.1';

// Shared store: the HTTP process and the MCP stdio process are separate
// processes, so state lives in a JSON file under DATA_DIR (the real server
// uses node:sqlite in the same dir; the fixture only needs parity of
// visibility, not durability guarantees).
const DATA_DIR = process.env.DATA_DIR || '.';
const STORE_FILE = path.join(DATA_DIR, 'fixture-store.json');

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return { nextId: 1, blueprints: {} };
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store));
}

const store = loadStore();
let nextId = store.nextId;
const blueprints = new Map(Object.entries(store.blueprints || {})); // id -> {id, name, state_type, version, phases: [], steps: [], layerItems: [], events: []}
const sseClients = new Set();

// Reload from disk before handling any request/message so the HTTP process
// and the MCP stdio process (separate OS processes) see each other's writes.
function refresh() {
  const fresh = loadStore();
  store.nextId = fresh.nextId;
  store.blueprints = fresh.blueprints || {};
  blueprints.clear();
  for (const [id, b] of Object.entries(store.blueprints)) {
    blueprints.set(id, b);
  }
  nextId = Math.max(nextId, store.nextId);
}

function persist() {
  store.nextId = nextId;
  store.blueprints = Object.fromEntries(blueprints);
  saveStore(store);
}

function bp(id) {
  refresh();
  return blueprints.get(id);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function recordEvent(b, type, payload) {
  const event = { seq: b.events.length + 1, type, payload, at: new Date().toISOString() };
  b.events.push(event);
  // VIOLATION 4: events are recorded but NEVER pushed to SSE subscribers.
  return event;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // ---- SSE endpoint (registered but silent) ----
  if (url.pathname.endsWith('/events') && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (parts[0] !== 'api') return sendJson(res, 404, { error: 'not found' });

  // POST /api/blueprints
  if (url.pathname === '/api/blueprints' && req.method === 'POST') {
    const body = await readBody(req);
    const id = `bp-${nextId++}`;
    const b = {
      id,
      name: body.name,
      state_type: body.state_type,
      version: 1,
      phases: [],
      steps: [],
      layerItems: [],
      events: [],
    };
    blueprints.set(id, b);
    persist();
    return sendJson(res, 201, { id, version: 1 });
  }

  // POST /api/blue-toolkit (alias endpoint from the contract)
  if (url.pathname === '/api/blue-toolkit' && req.method === 'POST') {
    const body = await readBody(req);
    // VIOLATION 1: no state gate at all — accept anything.
    const b = bp(body.blueprint_id);
    if (!b) return sendJson(res, 404, { error: 'blueprint not found' });
    const item = {
      id: `li-${nextId++}`,
      step_id: body.step_id,
      layer_category: body.layer_category,
      content: body.content,
    };
    b.layerItems.push(item);
    recordEvent(b, 'layer_item_added', item);
    persist();
    return sendJson(res, 201, { id: item.id, version: ++b.version });
  }

  const m = url.pathname.match(/^\/api\/blueprints\/([^/]+)(\/.*)?$/);
  if (!m) return sendJson(res, 404, { error: 'not found' });
  const b = bp(m[1]);
  if (!b) return sendJson(res, 404, { error: 'blueprint not found' });
  const sub = m[2] || '';

  // GET /api/blueprints/{id} — hierarchical JSON
  if (sub === '' && req.method === 'GET') {
    return sendJson(res, 200, {
      id: b.id,
      name: b.name,
      state_type: b.state_type,
      version: b.version,
      phases: b.phases.map((p) => ({
        ...p,
        steps: b.steps
          .filter((s) => s.phase_id === p.id)
          .map((s) => ({
            ...s,
            layer_items: b.layerItems.filter((li) => li.step_id === s.id),
          })),
      })),
    });
  }

  if (sub === '/phases' && req.method === 'POST') {
    const body = await readBody(req);
    const phase = { id: `ph-${nextId++}`, blueprint_id: b.id, name: body.name };
    b.phases.push(phase);
    persist();
    return sendJson(res, 201, phase);
  }

  if (sub === '/steps' && req.method === 'POST') {
    const body = await readBody(req);
    const step = {
      id: `st-${nextId++}`,
      phase_id: body.phase_id,
      title: body.title,
      is_visible: body.is_visible !== false,
    };
    b.steps.push(step);
    persist();
    return sendJson(res, 201, step);
  }

  if (sub === '/layer-items' && req.method === 'POST') {
    const body = await readBody(req);
    // VIOLATION 2: If-Match is read and then IGNORED — stale writes silently
    // overwrite instead of 409.
    // VIOLATION 1: no category-vs-state validation.
    // VIOLATION 3: binary content accepted.
    const item = {
      id: `li-${nextId++}`,
      step_id: body.step_id,
      layer_category: body.layer_category,
      content: body.content,
    };
    b.layerItems.push(item);
    recordEvent(b, 'layer_item_added', item);
    persist();
    return sendJson(res, 201, { id: item.id, version: ++b.version });
  }

  return sendJson(res, 404, { error: 'not found' });
});

// ---- MCP stdio mode (when spawned with --mcp) ----
function handleMcpMessage(msg) {
  if (msg.method === 'initialize') {
    return write({
      jsonrpc: '2.0',
      id: msg.id,
      result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'noncompliant-fixture' } },
    });
  }
  if (msg.method === 'tools/list') {
    return write({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          { name: 'get_blueprint_schema' },
          { name: 'add_layer_item' },
          { name: 'export_action_plan' },
        ],
      },
    });
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    if (name === 'add_layer_item') {
      const b = bp(args.blueprint_id);
      if (!b) {
        return write({
          jsonrpc: '2.0',
          id: msg.id,
          result: { isError: true, content: [{ text: JSON.stringify({ status: 404, error: 'blueprint not found' }) }] },
        });
      }
      // VIOLATION 1 via MCP: no state gate.
      const item = {
        id: `li-${nextId++}`,
        step_id: args.step_id,
        layer_category: args.layer_category,
        content: args.content,
      };
      b.layerItems.push(item);
      recordEvent(b, 'layer_item_added', item);
      persist();
      return write({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: JSON.stringify({ id: item.id, version: ++b.version }) }] },
      });
    }
    if (name === 'export_action_plan') {
      const b = bp(args.blueprint_id);
      if (!b) {
        return write({
          jsonrpc: '2.0',
          id: msg.id,
          result: { isError: true, content: [{ text: JSON.stringify({ status: 404, error: 'blueprint not found' }) }] },
        });
      }
      const insights = b.layerItems
        .filter((li) => ['CRITICAL_MOMENT', 'OPPORTUNITY', 'POTENTIAL_PITFALL'].includes(li.layer_category))
        // VIOLATION 5: no parent step, no sibling layer items bundled.
        .map((li) => ({ insight: li }));
      return write({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: JSON.stringify({ insights }) }] },
      });
    }
    if (name === 'get_blueprint_schema') {
      const b = bp(args.blueprint_id);
      if (!b) {
        return write({
          jsonrpc: '2.0',
          id: msg.id,
          result: { isError: true, content: [{ text: JSON.stringify({ status: 404, error: 'blueprint not found' }) }] },
        });
      }
      return write({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: b.id,
                name: b.name,
                state_type: b.state_type,
                version: b.version,
                phases: b.phases.map((p) => ({
                  ...p,
                  steps: b.steps.filter((s) => s.phase_id === p.id).map((s) => ({
                    ...s,
                    layer_items: b.layerItems.filter((li) => li.step_id === s.id),
                  })),
                })),
              }),
            },
          ],
        },
      });
    }
  }
  if (msg.id !== undefined) {
    write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
}

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

if (process.argv.includes('--mcp')) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    buf += c;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        handleMcpMessage(JSON.parse(line));
      } catch {
        /* ignore malformed */
      }
    }
  });
} else {
  server.listen(PORT, HOST, () => {
    // Readiness signal for the harness (also human-readable).
    process.stdout.write(`listening ${HOST}:${PORT}\n`);
  });
}

module.exports = server;
