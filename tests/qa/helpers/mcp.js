'use strict';
// Minimal MCP stdio JSON-RPC client for tests. Spawns the server process,
// speaks JSON-RPC 2.0 over stdin/stdout (newline-delimited JSON), and
// implements the initialize handshake + tools/call. No external deps.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { REPO_ROOT } = require('./server');

class McpClient {
  constructor({ entry, env = {} }) {
    this.entry = entry;
    this.env = env;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
  }

  async start() {
    // The fixture needs an explicit --mcp flag; the real server may auto-
    // detect stdio mode. QA_MCP_ARGS lets a test override the spawn args.
    const extraArgs = (process.env.QA_MCP_ARGS || '--mcp').split(' ').filter(Boolean);
    this.child = spawn(process.execPath, [this.entry, ...extraArgs], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onData(chunk));
    this.child.stderr.on('data', () => {});
    await this.#call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'qa-suite', version: '0.0.0' },
    });
    this.#notify('notifications/initialized', {});
    return this;
  }

  #onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg);
      }
    }
  }

  #notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  #call(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP call timed out: ${method}`));
      }, 10000);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  // Returns { ok, result, error } for a tools/call. `ok` is true when the
  // tool ran without a JSON-RPC / tool-level error.
  async callTool(name, args) {
    const msg = await this.#call('tools/call', { name, arguments: args });
    if (msg.error) return { ok: false, error: msg.error, result: null };
    const result = msg.result || {};
    const isError = result.isError === true;
    const text = Array.isArray(result.content)
      ? result.content.map((c) => c.text || '').join('\n')
      : '';
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    return { ok: !isError, error: isError ? payload || text : null, result, text };
  }

  async listTools() {
    const msg = await this.#call('tools/list', {});
    return (msg.result && msg.result.tools) || [];
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.child || this.child.exitCode !== null) return resolve();
      this.child.once('exit', () => resolve());
      this.child.stdin.end();
      this.child.kill();
      setTimeout(() => {
        try {
          this.child.kill('SIGKILL');
        } catch {
          /* gone */
        }
      }, 2000).unref();
    });
  }
}

// Default MCP entry: the dedicated stdio MCP server (server/mcp.js).
function mcpEntry() {
  return process.env.QA_MCP_ENTRY || path.join(REPO_ROOT, 'server', 'mcp.js');
}

function startMcp(env = {}) {
  return new McpClient({ entry: mcpEntry(), env }).start();
}

module.exports = { McpClient, startMcp, mcpEntry };
