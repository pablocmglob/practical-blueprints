'use strict';
// Test harness: spawns a server under test (real server/index.js or the
// noncompliant fixture) on an ephemeral port with a temp data dir, waits for
// readiness, and tears everything down. Plain Node, no external deps.
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function request(base, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      `${base}${urlPath}`,
      {
        method,
        headers: {
          ...(data !== null
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* non-JSON body is fine */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

// Opens an SSE connection and collects events until `collectMs` elapses or
// `want` events arrived. Returns { events, close }.
function openSse(base, urlPath, { want = Infinity, collectMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`${base}${urlPath}`, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = {};
          for (const line of raw.split('\n')) {
            const m = line.match(/^(event|data|id):\s?(.*)$/);
            if (m) event[m[1]] = m[2];
          }
          if (event.data !== undefined || event.event !== undefined) events.push(event);
          if (events.length >= want) {
            resolve({ events, close: () => req.destroy() });
          }
        }
      });
      res.on('error', () => {});
    });
    req.on('error', reject);
    // Safety timeout: resolve with whatever we have.
    const timer = setTimeout(() => resolve({ events, close: () => req.destroy() }), collectMs);
    req.on('close', () => clearTimeout(timer));
  });
}

async function startServer({
  entry = path.join(REPO_ROOT, 'server', 'index.js'),
  env = {},
  readyPath = '/api/blueprints',
} = {}) {
  const port = await getFreePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'qa-gate-'));
  const child = spawn(process.execPath, [entry], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode}):\n${stderr}`);
    }
    try {
      const res = await request(base, 'GET', readyPath);
      if (res.status < 500) break; // reachable
      lastError = new Error(`readiness probe ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (lastError && Date.now() >= deadline) {
    child.kill();
    throw new Error(`server not ready in time: ${lastError.message}\n${stderr}`);
  }

  return {
    base,
    port,
    dataDir,
    request: (method, urlPath, opts) => request(base, method, urlPath, opts),
    openSse: (urlPath, opts) => openSse(base, urlPath, opts),
    stop: () =>
      new Promise((resolve) => {
        child.once('exit', () => {
          try {
            rmSync(dataDir, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
          resolve();
        });
        child.kill();
        // Windows fallback if SIGTERM is ignored
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, 2000).unref();
      }),
  };
}

module.exports = { startServer, request, openSse, getFreePort, REPO_ROOT };
