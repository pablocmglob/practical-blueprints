/** index.js — HTTP server for the Practical Blueprinting tool.
 *
 * Plain node:http, no external dependencies, no build step.
 * - Serves static files from ui/ (index.html at /).
 * - REST API under /api/ with optimistic concurrency (If-Match / body.version).
 * - SSE stream per blueprint at GET /api/blueprints/{id}/events; every
 *   mutation broadcasts a JSON event to all subscribers of that blueprint.
 * - Text-only enforcement on layer-item content (shared validator in db.js).
 *
 * Run: node server/index.js   (env: PORT, BB_DB_PATH)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  openDatabase,
  validateLayerCategory,
  validateTextContent,
  getBlueprint,
  getStepWithBlueprint,
  getBlueprintHierarchy,
  bumpVersion,
} = require("./db");

const PORT = Number(process.env.PORT || 8787);
const UI_DIR = path.join(__dirname, "..", "ui");
const db = openDatabase();

// --- SSE ---------------------------------------------------------------------

/** blueprintId → Set<ServerResponse> */
const sseSubscribers = new Map();

function broadcast(blueprintId, event) {
  const subscribers = sseSubscribers.get(Number(blueprintId));
  if (!subscribers) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(payload);
    } catch {
      subscribers.delete(res);
    }
  }
}

// --- Helpers -------------------------------------------------------------------

/**
 * Internal cross-process notify (POST /api/blueprints/{id}/notify).
 * The MCP stdio server runs in its own process; when it writes, it POSTs the
 * event here so this process's SSE subscribers receive it. Not part of the
 * public API contract.
 */
function handleNotify(req, res, blueprintId) {
  readBody(req)
    .then((event) => {
      broadcast(blueprintId, event);
      sendJson(res, 200, { notified: true });
    })
    .catch(() => sendJson(res, 400, { error: "invalid notify payload" }));
}

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function sendJson(res, status, body, headers) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) {
        reject(new HttpError(413, "request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Optimistic concurrency: the client must prove it saw the current version
 * via If-Match header or body.version. Returns the expected version.
 * Throws 409 with the current version when stale/missing-mismatch.
 */
function checkVersion(req, body, blueprint) {
  const expected =
    req.headers["if-match"] !== undefined
      ? Number(req.headers["if-match"])
      : body && body.version !== undefined
        ? Number(body.version)
        : undefined;
  if (expected === undefined || Number.isNaN(expected)) {
    throw new HttpError(428, "mutation requires If-Match: <version> (or body.version)", {
      current_version: blueprint.version,
    });
  }
  if (expected !== blueprint.version) {
    throw new HttpError(409, `version conflict: expected ${blueprint.version}, client had ${expected}`, {
      current_version: blueprint.version,
    });
  }
  return expected;
}

function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === "") {
      throw new HttpError(400, `missing required field '${f}'`);
    }
  }
}

// --- Static files ----------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(UI_DIR, rel));
  if (!filePath.startsWith(UI_DIR)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

// --- API handlers ------------------------------------------------------------------

function handleCreateBlueprint(req, res) {
  return readBody(req).then((body) => {
    requireFields(body, ["name", "state_type"]);
    if (!["CURRENT_STATE", "FUTURE_STATE"].includes(body.state_type)) {
      throw new HttpError(400, "state_type must be CURRENT_STATE or FUTURE_STATE");
    }
    const result = db
      .prepare("INSERT INTO blueprints (name, state_type) VALUES (?, ?)")
      .run(String(body.name), body.state_type);
    const blueprint = getBlueprint(db, Number(result.lastInsertRowid));
    broadcast(blueprint.id, { type: "blueprint_created", blueprint_id: blueprint.id, blueprint });
    sendJson(res, 201, blueprint);
  });
}

function handleListBlueprints(res) {
  const rows = db.prepare("SELECT * FROM blueprints ORDER BY id").all();
  sendJson(res, 200, rows);
}

function handleGetBlueprint(res, id) {
  const hierarchy = getBlueprintHierarchy(db, id);
  if (!hierarchy) throw new HttpError(404, `blueprint ${id} not found`);
  sendJson(res, 200, hierarchy, { etag: String(hierarchy.version) });
}

function handleCreatePhase(req, res, id) {
  const blueprint = getBlueprint(db, id);
  if (!blueprint) throw new HttpError(404, `blueprint ${id} not found`);
  return readBody(req).then((body) => {
    requireFields(body, ["name"]);
    checkVersion(req, body, blueprint);
    const maxOrder = db
      .prepare("SELECT COALESCE(MAX(display_order), -1) AS m FROM phases WHERE blueprint_id = ?")
      .get(id).m;
    const result = db
      .prepare("INSERT INTO phases (blueprint_id, name, display_order) VALUES (?, ?, ?)")
      .run(id, String(body.name), body.display_order !== undefined ? Number(body.display_order) : maxOrder + 1);
    const version = bumpVersion(db, id);
    const phase = db.prepare("SELECT * FROM phases WHERE id = ?").get(Number(result.lastInsertRowid));
    broadcast(id, { type: "phase_created", blueprint_id: id, phase, version });
    sendJson(res, 201, { phase, version });
  });
}

function handleCreateStep(req, res, id) {
  const blueprint = getBlueprint(db, id);
  if (!blueprint) throw new HttpError(404, `blueprint ${id} not found`);
  return readBody(req).then((body) => {
    requireFields(body, ["phase_id", "title"]);
    checkVersion(req, body, blueprint);
    const phase = db
      .prepare("SELECT * FROM phases WHERE id = ? AND blueprint_id = ?")
      .get(Number(body.phase_id), id);
    if (!phase) throw new HttpError(400, `phase ${body.phase_id} not found in blueprint ${id}`);
    const maxOrder = db
      .prepare("SELECT COALESCE(MAX(display_order), -1) AS m FROM steps WHERE phase_id = ?")
      .get(phase.id).m;
    const result = db
      .prepare("INSERT INTO steps (phase_id, title, is_visible, display_order) VALUES (?, ?, ?, ?)")
      .run(
        phase.id,
        String(body.title),
        body.is_visible === false || body.is_visible === 0 ? 0 : 1,
        body.display_order !== undefined ? Number(body.display_order) : maxOrder + 1
      );
    const version = bumpVersion(db, id);
    const step = db.prepare("SELECT * FROM steps WHERE id = ?").get(Number(result.lastInsertRowid));
    broadcast(id, { type: "step_created", blueprint_id: id, step, version });
    sendJson(res, 201, { step, version });
  });
}

function handleCreateLayerItem(req, res, id) {
  const blueprint = getBlueprint(db, id);
  if (!blueprint) throw new HttpError(404, `blueprint ${id} not found`);
  return readBody(req).then((body) => {
    requireFields(body, ["step_id", "layer_category", "content"]);
    checkVersion(req, body, blueprint);
    const step = getStepWithBlueprint(db, Number(body.step_id));
    if (!step || step.blueprint_id !== id) {
      throw new HttpError(400, `step ${body.step_id} not found in blueprint ${id}`);
    }
    // Shared state gate (same function the MCP tools use).
    const categoryCheck = validateLayerCategory(blueprint.state_type, body.layer_category);
    if (!categoryCheck.ok) throw new HttpError(400, categoryCheck.reason, { current_version: blueprint.version });
    // Text-only enforcement.
    const textCheck = validateTextContent(body.content);
    if (!textCheck.ok) throw new HttpError(400, textCheck.reason, { current_version: blueprint.version });
    const result = db
      .prepare("INSERT INTO layer_items (step_id, layer_category, content, owner_id) VALUES (?, ?, ?, ?)")
      .run(step.id, body.layer_category, String(body.content), body.owner_id ? String(body.owner_id) : null);
    const version = bumpVersion(db, id);
    const layerItem = db.prepare("SELECT * FROM layer_items WHERE id = ?").get(Number(result.lastInsertRowid));
    broadcast(id, { type: "layer_item_created", blueprint_id: id, layer_item: layerItem, version });
    sendJson(res, 201, { layer_item: layerItem, version });
  });
}

function handleDelete(req, res, id, kind, childId) {
  const blueprint = getBlueprint(db, id);
  if (!blueprint) throw new HttpError(404, `blueprint ${id} not found`);
  return readBody(req).then((body) => {
    checkVersion(req, body || {}, blueprint);
    const table = { phases: "phases", steps: "steps", "layer-items": "layer_items" }[kind];
    if (!table) throw new HttpError(400, `unknown resource '${kind}'`);
    // Verify the child belongs to this blueprint before deleting.
    const row = db
      .prepare(
        kind === "phases"
          ? "SELECT id FROM phases WHERE id = ? AND blueprint_id = ?"
          : kind === "steps"
            ? `SELECT s.id FROM steps s JOIN phases p ON p.id = s.phase_id WHERE s.id = ? AND p.blueprint_id = ?`
            : `SELECT li.id FROM layer_items li JOIN steps s ON s.id = li.step_id JOIN phases p ON p.id = s.phase_id WHERE li.id = ? AND p.blueprint_id = ?`
      )
      .get(Number(childId), id);
    if (!row) throw new HttpError(404, `${kind}/${childId} not found in blueprint ${id}`);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(childId));
    const version = bumpVersion(db, id);
    broadcast(id, { type: `${kind.replace("-", "_")}_deleted`, blueprint_id: id, id: Number(childId), version });
    sendJson(res, 200, { deleted: Number(childId), version });
  });
}

function handleSse(req, res, id) {
  const blueprint = getBlueprint(db, id);
  if (!blueprint) throw new HttpError(404, `blueprint ${id} not found`);
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`retry: 2000\n\n`);
  if (!sseSubscribers.has(id)) sseSubscribers.set(id, new Set());
  sseSubscribers.get(id).add(res);
  req.on("close", () => {
    sseSubscribers.get(id)?.delete(res);
  });
}

// --- Router ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathName = decodeURIComponent(url.pathname);

  const run = async () => {
    if (!pathName.startsWith("/api/")) {
      serveStatic(req, res, pathName);
      return;
    }
    try {
      const parts = pathName.split("/").filter(Boolean); // ["api", ...]
      // /api/blueprints
      if (pathName === "/api/blueprints" && req.method === "POST") return await handleCreateBlueprint(req, res);
      if (pathName === "/api/blueprints" && req.method === "GET") return handleListBlueprints(res);
      // /api/blueprints/{id}/...
      if (parts[1] === "blueprints" && /^\d+$/.test(parts[2] || "")) {
        const id = Number(parts[2]);
        const rest = parts.slice(3).join("/");
        if (rest === "" && req.method === "GET") return handleGetBlueprint(res, id);
        if (rest === "phases" && req.method === "POST") return await handleCreatePhase(req, res, id);
        if (rest === "steps" && req.method === "POST") return await handleCreateStep(req, res, id);
        if (rest === "layer-items" && req.method === "POST") return await handleCreateLayerItem(req, res, id);
        if (rest === "events" && req.method === "GET") return handleSse(req, res, id);
        // Internal cross-process notify: the MCP stdio server POSTs here so
        // its writes reach this process's SSE subscribers. Not part of the
        // public API contract.
        if (rest === "notify" && req.method === "POST") return handleNotify(req, res, id);
        const deleteMatch = /^(phases|steps|layer-items)\/(\d+)$/.exec(rest);
        if (deleteMatch && req.method === "DELETE") {
          return await handleDelete(req, res, id, deleteMatch[1], deleteMatch[2]);
        }
      }
      throw new HttpError(404, `no route for ${req.method} ${pathName}`);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, ...err.extra });
      } else {
        console.error("unhandled error:", err);
        sendJson(res, 500, { error: "internal server error" });
      }
    }
  };
  run();
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`business-blueprints backend listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = { server, broadcast };
