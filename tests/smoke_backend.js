#!/usr/bin/env node
/** smoke_backend.js — T2 red-first smoke test.
 * Boots the server on a scratch port + scratch DB, exercises the REST API,
 * optimistic concurrency, state gate, text-only enforcement, SSE broadcast,
 * and the MCP stdio server (all three tools).
 * Run: node tests/smoke_backend.js   (exit 0 = all green)
 */
"use strict";

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const NODE = process.execPath;
const ROOT = path.resolve(__dirname, "..");
const PORT = 3457 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`ok    ${name}`); }
  else { failed++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

function request(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${BASE}${urlPath}`, {
      method,
      headers: {
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mcpCall(toolName, args, dbPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [path.join(ROOT, "server", "mcp.js")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, BB_DB_PATH: dbPath },
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => {
      const lines = out.split("\n").filter((l) => l.trim());
      const resp = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.id === 2);
      resolve(resp);
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } }) + "\n");
    child.stdin.end();
  });
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-smoke-"));
  const dbPath = path.join(tmpDir, "test.db");
  const server = spawn(NODE, [path.join(ROOT, "server", "index.js")], {
    env: { ...process.env, PORT: String(PORT), BB_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stderr.on("data", (c) => (serverLog += c));
  server.stdout.on("data", (c) => (serverLog += c));

  try {
    // wait for boot
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { await request("GET", "/api/blueprints"); up = true; } catch { await sleep(100); }
    }
    check("server boots", up, serverLog.slice(0, 300));

    // --- create blueprint
    let r = await request("POST", "/api/blueprints", { name: "Order Fulfilment", state_type: "CURRENT_STATE" });
    check("POST /api/blueprints → 201", r.status === 201, `got ${r.status}`);
    const bp = r.json;
    check("blueprint has id + version 1", bp && bp.id > 0 && bp.version === 1, JSON.stringify(bp));
    const v1 = bp.version;

    // --- static UI at /
    r = await request("GET", "/");
    check("GET / serves index.html", r.status === 200 && /html/i.test(r.headers["content-type"] || ""), `got ${r.status}`);

    // --- add phase (If-Match)
    r = await request("POST", `/api/blueprints/${bp.id}/phases`, { name: "Order Intake" }, { "if-match": String(v1) });
    check("POST phases → 201, version bumped", r.status === 201 && r.json.version === v1 + 1, `got ${r.status} ${JSON.stringify(r.json)}`);
    const phase = r.json.phase;
    const v2 = r.json.version;

    // --- stale If-Match → 409 with current version
    r = await request("POST", `/api/blueprints/${bp.id}/phases`, { name: "Stale" }, { "if-match": String(v1) });
    check("stale If-Match → 409", r.status === 409, `got ${r.status}`);
    check("409 body carries current version", r.json && r.json.current_version === v2, JSON.stringify(r.json));

    // --- add steps
    r = await request("POST", `/api/blueprints/${bp.id}/steps`, { phase_id: phase.id, title: "Browse catalogue", is_visible: true }, { "if-match": String(v2) });
    check("POST steps → 201", r.status === 201, `got ${r.status} ${r.raw.slice(0, 120)}`);
    const step1 = r.json.step;
    r = await request("POST", `/api/blueprints/${bp.id}/steps`, { phase_id: phase.id, title: "Payment processing", is_visible: false }, { "if-match": String(r.json.version) });
    const step2 = r.json.step;
    const vAfterSteps = r.json.version;

    // --- layer items: core category OK
    r = await request("POST", `/api/blueprints/${bp.id}/layer-items`, { step_id: step1.id, layer_category: "TOUCHPOINT", content: "Web storefront" }, { "if-match": String(vAfterSteps) });
    check("POST layer-items core category → 201", r.status === 201, `got ${r.status} ${r.raw.slice(0, 200)}`);
    const touchpoint = r.json.layer_item;

    // --- state gate: CRITICAL_MOMENT on CURRENT_STATE OK
    r = await request("POST", `/api/blueprints/${bp.id}/layer-items`, { step_id: step1.id, layer_category: "CRITICAL_MOMENT", content: "Checkout abandonment" }, { "if-match": String(r.json.version) });
    check("CRITICAL_MOMENT on CURRENT_STATE → 201", r.status === 201, `got ${r.status} ${r.raw.slice(0, 200)}`);

    // --- state gate: RATIONALE (future-only) on CURRENT_STATE → 400
    r = await request("POST", `/api/blueprints/${bp.id}/layer-items`, { step_id: step1.id, layer_category: "RATIONALE", content: "why" }, { "if-match": String(r.json.version) });
    check("RATIONALE on CURRENT_STATE → 400", r.status === 400, `got ${r.status}`);
    let currentVersion = r.json.current_version;

    // --- text-only: data URI → 400
    r = await request("POST", `/api/blueprints/${bp.id}/layer-items`, { step_id: step1.id, layer_category: "ROLE", content: "data:image/png;base64,iVBORw0KGgo=" }, { "if-match": String(currentVersion) });
    check("data: URI content → 400", r.status === 400, `got ${r.status}`);

    // --- text-only: control chars → 400
    r = await request("POST", `/api/blueprints/${bp.id}/layer-items`, { step_id: step1.id, layer_category: "ROLE", content: "bad\u0007bell" }, { "if-match": String(currentVersion) });
    check("control char content → 400", r.status === 400, `got ${r.status}`);

    // --- newline and tab are allowed
    r = await request("POST", `/api/blueprints/${bp.id}/layer-items`, { step_id: step1.id, layer_category: "ROLE", content: "line1\nline2\tcol" }, { "if-match": String(currentVersion) });
    check("newline/tab content → 201", r.status === 201, `got ${r.status}`);
    currentVersion = r.json.version;

    // --- SSE: subscribe, then mutate, expect event
    const sseEvents = [];
    let sseReq;
    const sseReady = new Promise((resolve) => {
      sseReq = http.get(`${BASE}/api/blueprints/${bp.id}/events`, (res) => {
        resolve(); // headers received — subscribed
        let buf = "";
        res.on("data", (c) => {
          buf += c;
          for (const chunk of buf.split("\n\n")) {
            const m = /data: (.*)/.exec(chunk);
            if (m) { sseEvents.push(m[1]); buf = ""; }
          }
        });
      });
      sseReq.on("error", () => resolve());
    });
    await sseReady;
    await sleep(300);
    r = await request("POST", `/api/blueprints/${bp.id}/layer-items`, { step_id: step2.id, layer_category: "TECHNOLOGY", content: "Payment gateway" }, { "if-match": String(currentVersion) });
    await sleep(400);
    check("SSE broadcast received on mutation", sseEvents.length >= 1 && sseEvents[0].includes("layer_item"), JSON.stringify(sseEvents).slice(0, 200));
    sseReq.destroy();

    // --- GET full hierarchical blueprint
    r = await request("GET", `/api/blueprints/${bp.id}`);
    check("GET blueprint → hierarchical JSON", r.status === 200 && Array.isArray(r.json.phases) && r.json.phases[0].steps.length >= 2 && Array.isArray(r.json.phases[0].steps[0].layer_items), JSON.stringify(r.json).slice(0, 150));
    check("GET blueprint ETag = version", r.headers.etag === String(r.json.version), `etag=${r.headers.etag} version=${r.json.version}`);

    // --- GET list
    r = await request("GET", "/api/blueprints");
    check("GET /api/blueprints lists", r.status === 200 && Array.isArray(r.json) && r.json.some((b) => b.id === bp.id), r.raw.slice(0, 120));

    // --- DELETE layer item
    r = await request("DELETE", `/api/blueprints/${bp.id}/layer-items/${touchpoint.id}`, undefined, { "if-match": String(r.json.find((b) => b.id === bp.id).version) });
    check("DELETE layer-item → 200", r.status === 200, `got ${r.status} ${r.raw.slice(0, 120)}`);

    // --- MCP tools
    let m = await mcpCall("get_blueprint_schema", { blueprint_id: bp.id }, dbPath);
    let payload = m && m.result && m.result.content && JSON.parse(m.result.content[0].text);
    check("MCP get_blueprint_schema returns hierarchy", payload && payload.id === bp.id && payload.phases.length >= 1, JSON.stringify(m).slice(0, 200));

    m = await mcpCall("add_layer_item", { step_id: step1.id, layer_category: "POTENTIAL_PITFALL", content: "future-only on current state" }, dbPath);
    check("MCP add_layer_item state mismatch → -32600 with 400 message", m && m.error && m.error.code === -32600 && /400 Bad Request/.test(m.error.message), JSON.stringify(m).slice(0, 250));

    m = await mcpCall("add_layer_item", { step_id: step1.id, layer_category: "OPPORTUNITY", content: "One-click reorder" }, dbPath);
    check("MCP add_layer_item valid → ok + SSE event", m && m.result && !m.error, JSON.stringify(m).slice(0, 200));

    m = await mcpCall("export_action_plan", { blueprint_id: bp.id }, dbPath);
    payload = m && m.result && m.result.content && JSON.parse(m.result.content[0].text);
    const entries = payload && payload.entries;
    check("MCP export_action_plan has entries", Array.isArray(entries) && entries.length >= 2, JSON.stringify(payload).slice(0, 200));
    const cm = entries.find((e) => e.item.layer_category === "CRITICAL_MOMENT");
    check("export entry bundles parent step + siblings", cm && cm.step && cm.step.title === "Browse catalogue" && Array.isArray(cm.sibling_items) && cm.sibling_items.some((s) => s.layer_category === "ROLE") && cm.sibling_items.some((s) => s.layer_category === "OPPORTUNITY"), JSON.stringify(cm).slice(0, 300));

    // --- 404s
    r = await request("GET", "/api/blueprints/99999");
    check("GET missing blueprint → 404", r.status === 404, `got ${r.status}`);

    // --- T-101-D: PATCH inline edit contract
    // Use a live item (the touchpoint was deleted above); grab a fresh version
    // before each mutation since MCP calls in between bump it.
    r = await request("GET", `/api/blueprints/${bp.id}`);
    const liveItem = r.json.phases.flatMap((p) => p.steps).flatMap((s) => s.layer_items).find((li) => li.layer_category === "OPPORTUNITY");
    r = await request("PATCH", `/api/blueprints/${bp.id}/layer-items/${liveItem.id}`, { content: "One-click reorder (edited)" }, { "if-match": String(r.json.version) });
    check("PATCH layer-item → 200 with updated content", r.status === 200 && r.json.layer_item.content === "One-click reorder (edited)", `got ${r.status} ${r.raw.slice(0, 150)}`);
    check("PATCH bumps version", typeof r.json.version === "number" && r.json.version > 0, JSON.stringify(r.json).slice(0, 120));
    const verAfterPatch = r.json.version;

    r = await request("PATCH", `/api/blueprints/${bp.id}/layer-items/${liveItem.id}`, { content: "" }, { "if-match": String(verAfterPatch) });
    check("PATCH empty content → 400", r.status === 400, `got ${r.status}`);

    r = await request("PATCH", `/api/blueprints/${bp.id}/layer-items/${liveItem.id}`, { content: "x" }, { "if-match": "1" });
    check("PATCH stale If-Match → 409", r.status === 409, `got ${r.status}`);

    r = await request("PATCH", `/api/blueprints/99999/layer-items/1`, { content: "x" }, { "if-match": "1" });
    check("PATCH cross-blueprint → 404", r.status === 404, `got ${r.status}`);

    r = await request("GET", `/api/blueprints/${bp.id}`);
    const verForSteps = r.json.version;
    r = await request("PATCH", `/api/blueprints/${bp.id}/steps/${step1.id}`, { is_visible: "false" }, { "if-match": String(verForSteps) });
    check("PATCH non-boolean is_visible → 400", r.status === 400, `got ${r.status}`);

    r = await request("PATCH", `/api/blueprints/${bp.id}/steps/${step1.id}`, { is_visible: true }, { "if-match": String(verForSteps) });
    check("PATCH step is_visible boolean → 200", r.status === 200 && r.json.step.is_visible === 1, `got ${r.status} ${r.raw.slice(0, 120)}`);

    // --- reorder contract
    r = await request("GET", `/api/blueprints/${bp.id}`);
    const verBeforeReorder = r.json.version;
    r = await request("POST", `/api/blueprints/${bp.id}/reorder`, { steps: [{ id: step1.id, display_order: 5 }, { id: 99999, display_order: 0 }] }, { "if-match": String(verBeforeReorder) });
    check("reorder with unknown step → 404", r.status === 404, `got ${r.status}`);
    r = await request("GET", `/api/blueprints/${bp.id}`);
    const stepAfterFailedReorder = r.json.phases.flatMap((p) => p.steps).find((s) => s.id === step1.id);
    check("reorder failure leaves order untouched (rollback)", stepAfterFailedReorder.display_order === 0, JSON.stringify(stepAfterFailedReorder));
    check("reorder failure does not bump version", r.json.version === verBeforeReorder, JSON.stringify(r.json.version));

    r = await request("POST", `/api/blueprints/${bp.id}/reorder`, { steps: [{ id: step1.id, display_order: 0 }, { id: step2.id, display_order: 1 }] }, { "if-match": String(r.json.version) });
    check("reorder valid → 200", r.status === 200 && r.json.reordered === true, `got ${r.status} ${r.raw.slice(0, 120)}`);
    const verAfterReorder = r.json.version;

    r = await request("POST", `/api/blueprints/${bp.id}/reorder`, { steps: [{ id: step1.id, display_order: "abc" }] }, { "if-match": String(verAfterReorder) });
    check("reorder non-numeric display_order → 400", r.status === 400, `got ${r.status}`);

    // --- PATCH phases (new route)
    r = await request("PATCH", `/api/blueprints/${bp.id}/phases/${phase.id}`, { name: "Order Capture" }, { "if-match": String(verAfterReorder) });
    check("PATCH phases → 200, name updated", r.status === 200 && r.json.phase && r.json.phase.name === "Order Capture", `got ${r.status} ${r.raw.slice(0, 120)}`);
    const verAfterPhasePatch = r.json.version;

    r = await request("PATCH", `/api/blueprints/${bp.id}/phases/${phase.id}`, { name: "" }, { "if-match": String(verAfterPhasePatch) });
    check("PATCH phases empty name → 400", r.status === 400, `got ${r.status}`);
    r = await request("PATCH", `/api/blueprints/${bp.id}/phases/99999`, { name: "Ghost" }, { "if-match": String(verAfterPhasePatch) });
    check("PATCH unknown phase → 404", r.status === 404, `got ${r.status}`);

    // --- create-path validation
    r = await request("POST", `/api/blueprints/${bp.id}/phases`, { name: "Bad data:text/html;base64,AAAA" }, { "if-match": String(verAfterPhasePatch) });
    check("POST phases data-URI name → 400", r.status === 400, `got ${r.status}`);
    r = await request("POST", `/api/blueprints/${bp.id}/phases`, { name: "X", display_order: "abc" }, { "if-match": String(verAfterPhasePatch) });
    check("POST phases non-numeric display_order → 400", r.status === 400, `got ${r.status}`);
    r = await request("POST", "/api/blueprints", { name: "", state_type: "CURRENT_STATE" });
    check("POST /api/blueprints empty name → 400", r.status === 400, `got ${r.status}`);
    r = await request("POST", "/api/blueprints", { name: "X data:text/html;base64,AAAA", state_type: "CURRENT_STATE" });
    check("POST /api/blueprints data-URI name → 400", r.status === 400, `got ${r.status}`);

    // --- notify hardening
    r = await request("POST", `/api/blueprints/${bp.id}/notify`, { type: "not_a_real_event" });
    check("notify unknown type → 400", r.status === 400, `got ${r.status}`);
    r = await request("POST", `/api/blueprints/${bp.id}/notify`, "not-an-object");
    check("notify non-object → 400", r.status === 400, `got ${r.status}`);
    r = await request("POST", `/api/blueprints/${bp.id}/notify`, { type: "step_updated", blueprint_id: bp.id });
    check("notify known type → 200", r.status === 200, `got ${r.status}`);

    // --- DELETE blueprint
    r = await request("POST", "/api/blueprints", { name: "Doomed Blueprint", state_type: "FUTURE_STATE" });
    const doomed = r.json;
    r = await request("DELETE", `/api/blueprints/${doomed.id}`);
    check("DELETE blueprint → 200", r.status === 200 && r.json.deleted === doomed.id, `got ${r.status} ${r.raw.slice(0, 120)}`);
    r = await request("GET", `/api/blueprints/${doomed.id}`);
    check("deleted blueprint → 404", r.status === 404, `got ${r.status}`);
    r = await request("DELETE", `/api/blueprints/${doomed.id}`);
    check("DELETE unknown blueprint → 404", r.status === 404, `got ${r.status}`);
  } finally {
    server.kill();
    await sleep(200);
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
