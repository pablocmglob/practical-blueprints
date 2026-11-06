/** mcp.js — MCP server over stdio (JSON-RPC 2.0), no external dependencies.
 *
 * Exposes the FULL editing surface of the web UI as MCP tools:
 * - get_blueprint_schema(blueprint_id) → full hierarchical JSON
 * - add_layer_item(step_id, layer_category, content) → validates category vs
 *   the parent blueprint's state_type using the SAME shared validator as the
 *   REST API; mismatch → JSON-RPC error code -32600 with a "400 Bad Request:
 *   ..." message. Success broadcasts an SSE event so live UIs update.
 * - export_action_plan(blueprint_id) → all CRITICAL_MOMENT / OPPORTUNITY /
 *   POTENTIAL_PITFALL items, each bundled with parent step details and ALL
 *   sibling layer items on that step.
 * - Blueprint lifecycle: list_blueprints, create_blueprint, delete_blueprint.
 * - Phases: create_phase, update_phase, delete_phase.
 * - Steps: create_step, update_step, delete_step.
 * - Layer items: update_layer_item, delete_layer_item.
 * - Ordering: reorder_steps.
 *
 * Every mutation validates with the SAME shared validators as the REST API
 * (state gate + text-only), bumps the blueprint version, and POSTs the event
 * to the HTTP server's notify bridge so SSE subscribers update live.
 *
 * Run: node server/mcp.js   (speaks newline-delimited JSON-RPC 2.0 on stdio)
 */
"use strict";

const readline = require("readline");
const http = require("http");
const {
  openDatabase,
  validateLayerCategory,
  validateTextContent,
  getBlueprint,
  getStepWithBlueprint,
  getBlueprintHierarchy,
  bumpVersion,
} = require("./db");

// Reuse the HTTP server's broadcast so MCP-injected changes reach SSE
// subscribers. The MCP server runs in its own process, so it cannot share the
// HTTP server's in-memory subscriber map; instead it POSTs the event to the
// HTTP server's internal notify route. If the HTTP server is not running
// (MCP-only usage), the POST fails and is silently ignored.
let broadcast = () => {};
const NOTIFY_PORT = process.env.BB_NOTIFY_PORT || process.env.PORT || "8787";
function broadcastViaHttp(blueprintId, event) {
  const data = JSON.stringify(event);
  const req = http.request(
    `http://127.0.0.1:${NOTIFY_PORT}/api/blueprints/${Number(blueprintId)}/notify`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data),
      },
    },
    (res) => {
      res.resume(); // drain
      if (res.statusCode !== 200) {
        // Notify rejected (bad port, hardened allowlist, …) — never silent,
        // otherwise MCP writes become invisible to SSE clients (T2-M1).
        console.error(`[mcp] notify POST failed: HTTP ${res.statusCode}`);
      }
    }
  );
  req.on("error", (err) => {
    // HTTP server not running or wrong port — log so the drop is visible (T2-M1).
    console.error(`[mcp] notify POST to 127.0.0.1:${NOTIFY_PORT} failed: ${err.message}`);
  });
  req.end(data);
}
broadcast = broadcastViaHttp;

const db = openDatabase();

// --- JSON-RPC plumbing -----------------------------------------------------------

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function rpcError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function rpcResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

// --- Tool implementations ----------------------------------------------------------

function toolGetBlueprintSchema(args) {
  const blueprintId = Number(args.blueprint_id);
  if (!Number.isInteger(blueprintId)) throw new Error("400 Bad Request: blueprint_id must be a number");
  const hierarchy = getBlueprintHierarchy(db, blueprintId);
  if (!hierarchy) throw new Error(`404 Not Found: blueprint ${blueprintId} not found`);
  return {
    content: [{ type: "text", text: JSON.stringify(hierarchy) }],
  };
}

function toolAddLayerItem(args) {
  const stepId = Number(args.step_id);
  if (!Number.isInteger(stepId)) throw new Error("400 Bad Request: step_id must be a number");
  const step = getStepWithBlueprint(db, stepId);
  if (!step) throw new Error(`400 Bad Request: step ${stepId} not found`);
  const blueprint = getBlueprint(db, step.blueprint_id);
  // Shared state gate — identical semantics to the REST API.
  const categoryCheck = validateLayerCategory(blueprint.state_type, args.layer_category);
  if (!categoryCheck.ok) throw new Error(`400 Bad Request: ${categoryCheck.reason}`);
  const textCheck = validateTextContent(args.content);
  if (!textCheck.ok) throw new Error(`400 Bad Request: ${textCheck.reason}`);
  const result = db
    .prepare("INSERT INTO layer_items (step_id, layer_category, content, owner_id) VALUES (?, ?, ?, ?)")
    .run(step.id, String(args.layer_category), String(args.content), args.owner_id ? String(args.owner_id) : null);
  const version = bumpVersion(db, blueprint.id);
  const layerItem = db.prepare("SELECT * FROM layer_items WHERE id = ?").get(Number(result.lastInsertRowid));
  broadcast(blueprint.id, {
    type: "layer_item_created",
    blueprint_id: blueprint.id,
    layer_item: layerItem,
    version,
    source: "mcp",
  });
  return {
    content: [{ type: "text", text: JSON.stringify({ layer_item: layerItem, version }) }],
  };
}

function toolExportActionPlan(args) {
  const blueprintId = Number(args.blueprint_id);
  if (!Number.isInteger(blueprintId)) throw new Error("400 Bad Request: blueprint_id must be a number");
  const hierarchy = getBlueprintHierarchy(db, blueprintId);
  if (!hierarchy) throw new Error(`404 Not Found: blueprint ${blueprintId} not found`);
  const INSIGHT_CATEGORIES = ["CRITICAL_MOMENT", "OPPORTUNITY", "POTENTIAL_PITFALL"];
  const entries = [];
  for (const phase of hierarchy.phases) {
    for (const step of phase.steps) {
      const insightItems = step.layer_items.filter((li) => INSIGHT_CATEGORIES.includes(li.layer_category));
      if (!insightItems.length) continue;
      for (const item of insightItems) {
        entries.push({
          item,
          step: {
            id: step.id,
            title: step.title,
            is_visible: step.is_visible,
            display_order: step.display_order,
            phase_name: phase.name,
          },
          sibling_items: step.layer_items.filter((li) => li.id !== item.id),
        });
      }
    }
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          blueprint_id: hierarchy.id,
          blueprint_name: hierarchy.name,
          state_type: hierarchy.state_type,
          entries,
        }),
      },
    ],
  };
}

// --- Full editing surface (T5): blueprint lifecycle, phases, steps, items ---

function requireBlueprintId(args) {
  const blueprintId = Number(args.blueprint_id);
  if (!Number.isInteger(blueprintId)) throw new Error("400 Bad Request: blueprint_id must be a number");
  const blueprint = getBlueprint(db, blueprintId);
  if (!blueprint) throw new Error(`404 Not Found: blueprint ${blueprintId} not found`);
  return blueprint;
}

function toolListBlueprints() {
  const rows = db.prepare("SELECT * FROM blueprints ORDER BY id").all();
  return { content: [{ type: "text", text: JSON.stringify(rows) }] };
}

function toolCreateBlueprint(args) {
  const name = String(args.name || "").trim();
  if (!name) throw new Error("400 Bad Request: name is required");
  const stateType = String(args.state_type || "");
  if (!["CURRENT_STATE", "FUTURE_STATE"].includes(stateType)) {
    throw new Error("400 Bad Request: state_type must be CURRENT_STATE or FUTURE_STATE");
  }
  const result = db
    .prepare("INSERT INTO blueprints (name, state_type) VALUES (?, ?)")
    .run(name, stateType);
  const blueprint = db.prepare("SELECT * FROM blueprints WHERE id = ?").get(Number(result.lastInsertRowid));
  broadcast(blueprint.id, { type: "blueprint_created", blueprint_id: blueprint.id, blueprint, source: "mcp" });
  return {
    content: [{ type: "text", text: JSON.stringify({ blueprint, version: blueprint.version }) }],
  };
}

function toolDeleteBlueprint(args) {
  const blueprintId = Number(args.blueprint_id);
  if (!Number.isInteger(blueprintId)) throw new Error("400 Bad Request: blueprint_id must be a number");
  const blueprint = getBlueprint(db, blueprintId);
  if (!blueprint) throw new Error(`404 Not Found: blueprint ${blueprintId} not found`);
  db.prepare("DELETE FROM blueprints WHERE id = ?").run(blueprintId);
  broadcast(blueprintId, { type: "blueprint_deleted", blueprint_id: blueprintId, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ deleted: blueprintId }) }] };
}

function toolCreatePhase(args) {
  const blueprint = requireBlueprintId(args);
  const name = String(args.name || "").trim();
  if (!name) throw new Error("400 Bad Request: name is required");
  const result = db
    .prepare("INSERT INTO phases (blueprint_id, name, display_order) VALUES (?, ?, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM phases WHERE blueprint_id = ?))")
    .run(blueprint.id, name, blueprint.id);
  const version = bumpVersion(db, blueprint.id);
  const phase = db.prepare("SELECT * FROM phases WHERE id = ?").get(Number(result.lastInsertRowid));
  broadcast(blueprint.id, { type: "phase_created", blueprint_id: blueprint.id, phase, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ phase, version }) }] };
}

function toolUpdatePhase(args) {
  const blueprint = requireBlueprintId(args);
  const phaseId = Number(args.phase_id);
  if (!Number.isInteger(phaseId)) throw new Error("400 Bad Request: phase_id must be a number");
  const phase = db.prepare("SELECT * FROM phases WHERE id = ? AND blueprint_id = ?").get(phaseId, blueprint.id);
  if (!phase) throw new Error(`404 Not Found: phase ${phaseId} not found in blueprint ${blueprint.id}`);
  const name = String(args.name || "").trim();
  if (!name) throw new Error("400 Bad Request: name is required");
  db.prepare("UPDATE phases SET name = ? WHERE id = ?").run(name, phaseId);
  const version = bumpVersion(db, blueprint.id);
  const updated = db.prepare("SELECT * FROM phases WHERE id = ?").get(phaseId);
  broadcast(blueprint.id, { type: "phase_updated", blueprint_id: blueprint.id, phase: updated, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ phase: updated, version }) }] };
}

function toolDeletePhase(args) {
  const blueprint = requireBlueprintId(args);
  const phaseId = Number(args.phase_id);
  if (!Number.isInteger(phaseId)) throw new Error("400 Bad Request: phase_id must be a number");
  const phase = db.prepare("SELECT * FROM phases WHERE id = ? AND blueprint_id = ?").get(phaseId, blueprint.id);
  if (!phase) throw new Error(`404 Not Found: phase ${phaseId} not found in blueprint ${blueprint.id}`);
  db.prepare("DELETE FROM phases WHERE id = ?").run(phaseId);
  const version = bumpVersion(db, blueprint.id);
  broadcast(blueprint.id, { type: "phase_deleted", blueprint_id: blueprint.id, phase_id: phaseId, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ deleted: phaseId, version }) }] };
}

function toolCreateStep(args) {
  const blueprint = requireBlueprintId(args);
  const phaseId = Number(args.phase_id);
  if (!Number.isInteger(phaseId)) throw new Error("400 Bad Request: phase_id must be a number");
  const phase = db.prepare("SELECT * FROM phases WHERE id = ? AND blueprint_id = ?").get(phaseId, blueprint.id);
  if (!phase) throw new Error(`400 Bad Request: phase ${phaseId} not found in blueprint ${blueprint.id}`);
  const title = String(args.title || "").trim();
  if (!title) throw new Error("400 Bad Request: title is required");
  const isVisible = args.is_visible === undefined ? 1 : (args.is_visible ? 1 : 0);
  const result = db
    .prepare("INSERT INTO steps (phase_id, title, is_visible, display_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM steps WHERE phase_id = ?))")
    .run(phaseId, title, isVisible, phaseId);
  const version = bumpVersion(db, blueprint.id);
  const step = db.prepare("SELECT * FROM steps WHERE id = ?").get(Number(result.lastInsertRowid));
  broadcast(blueprint.id, { type: "step_created", blueprint_id: blueprint.id, step, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ step, version }) }] };
}

function toolUpdateStep(args) {
  const blueprint = requireBlueprintId(args);
  const stepId = Number(args.step_id);
  if (!Number.isInteger(stepId)) throw new Error("400 Bad Request: step_id must be a number");
  const step = db
    .prepare("SELECT s.* FROM steps s JOIN phases p ON s.phase_id = p.id WHERE s.id = ? AND p.blueprint_id = ?")
    .get(stepId, blueprint.id);
  if (!step) throw new Error(`404 Not Found: step ${stepId} not found in blueprint ${blueprint.id}`);
  if (args.title !== undefined) {
    const title = String(args.title || "").trim();
    if (!title) throw new Error("400 Bad Request: title cannot be empty");
    db.prepare("UPDATE steps SET title = ? WHERE id = ?").run(title, stepId);
  }
  if (args.is_visible !== undefined) {
    db.prepare("UPDATE steps SET is_visible = ? WHERE id = ?").run(args.is_visible ? 1 : 0, stepId);
  }
  const version = bumpVersion(db, blueprint.id);
  const updated = db.prepare("SELECT * FROM steps WHERE id = ?").get(stepId);
  broadcast(blueprint.id, { type: "step_updated", blueprint_id: blueprint.id, step: updated, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ step: updated, version }) }] };
}

function toolDeleteStep(args) {
  const blueprint = requireBlueprintId(args);
  const stepId = Number(args.step_id);
  if (!Number.isInteger(stepId)) throw new Error("400 Bad Request: step_id must be a number");
  const step = db
    .prepare("SELECT s.* FROM steps s JOIN phases p ON s.phase_id = p.id WHERE s.id = ? AND p.blueprint_id = ?")
    .get(stepId, blueprint.id);
  if (!step) throw new Error(`404 Not Found: step ${stepId} not found in blueprint ${blueprint.id}`);
  db.prepare("DELETE FROM steps WHERE id = ?").run(stepId);
  const version = bumpVersion(db, blueprint.id);
  broadcast(blueprint.id, { type: "step_deleted", blueprint_id: blueprint.id, step_id: stepId, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ deleted: stepId, version }) }] };
}

function toolUpdateLayerItem(args) {
  const blueprint = requireBlueprintId(args);
  const itemId = Number(args.layer_item_id);
  if (!Number.isInteger(itemId)) throw new Error("400 Bad Request: layer_item_id must be a number");
  const item = db
    .prepare("SELECT li.* FROM layer_items li JOIN steps s ON li.step_id = s.id JOIN phases p ON s.phase_id = p.id WHERE li.id = ? AND p.blueprint_id = ?")
    .get(itemId, blueprint.id);
  if (!item) throw new Error(`404 Not Found: layer item ${itemId} not found in blueprint ${blueprint.id}`);
  if (args.content === undefined) throw new Error("400 Bad Request: content is required");
  const textCheck = validateTextContent(args.content);
  if (!textCheck.ok) throw new Error(`400 Bad Request: ${textCheck.reason}`);
  db.prepare("UPDATE layer_items SET content = ? WHERE id = ?").run(String(args.content), itemId);
  const version = bumpVersion(db, blueprint.id);
  const updated = db.prepare("SELECT * FROM layer_items WHERE id = ?").get(itemId);
  broadcast(blueprint.id, { type: "layer_item_updated", blueprint_id: blueprint.id, layer_item: updated, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ layer_item: updated, version }) }] };
}

function toolDeleteLayerItem(args) {
  const blueprint = requireBlueprintId(args);
  const itemId = Number(args.layer_item_id);
  if (!Number.isInteger(itemId)) throw new Error("400 Bad Request: layer_item_id must be a number");
  const item = db
    .prepare("SELECT li.* FROM layer_items li JOIN steps s ON li.step_id = s.id JOIN phases p ON s.phase_id = p.id WHERE li.id = ? AND p.blueprint_id = ?")
    .get(itemId, blueprint.id);
  if (!item) throw new Error(`404 Not Found: layer item ${itemId} not found in blueprint ${blueprint.id}`);
  db.prepare("DELETE FROM layer_items WHERE id = ?").run(itemId);
  const version = bumpVersion(db, blueprint.id);
  broadcast(blueprint.id, { type: "layer_item_deleted", blueprint_id: blueprint.id, layer_item_id: itemId, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ deleted: itemId, version }) }] };
}

function toolReorderSteps(args) {
  const blueprint = requireBlueprintId(args);
  const steps = Array.isArray(args.steps) ? args.steps : null;
  if (!steps || steps.length === 0) throw new Error("400 Bad Request: steps must be a non-empty array of {id, display_order}");
  const owned = db
    .prepare("SELECT s.id FROM steps s JOIN phases p ON s.phase_id = p.id WHERE p.blueprint_id = ?")
    .all(blueprint.id)
    .map((r) => r.id);
  const ownedSet = new Set(owned);
  const writes = [];
  for (const entry of steps) {
    const stepId = Number(entry && entry.id);
    const order = Number(entry && entry.display_order);
    if (!Number.isInteger(stepId) || !Number.isInteger(order)) {
      throw new Error("400 Bad Request: each steps entry must be {id: number, display_order: number}");
    }
    if (!ownedSet.has(stepId)) {
      throw new Error(`400 Bad Request: step ${stepId} not found in blueprint ${blueprint.id}`);
    }
    writes.push({ stepId, order });
  }
  const update = db.prepare("UPDATE steps SET display_order = ? WHERE id = ?");
  for (const w of writes) update.run(w.order, w.stepId);
  const version = bumpVersion(db, blueprint.id);
  broadcast(blueprint.id, { type: "steps_reordered", blueprint_id: blueprint.id, version, source: "mcp" });
  return { content: [{ type: "text", text: JSON.stringify({ reordered: writes.length, version }) }] };
}

const TOOLS = [
  {
    name: "get_blueprint_schema",
    description: "Return the full hierarchical JSON of a blueprint (phases → steps → layer_items).",
    inputSchema: {
      type: "object",
      properties: { blueprint_id: { type: "number", description: "Blueprint id" } },
      required: ["blueprint_id"],
    },
  },
  {
    name: "add_layer_item",
    description:
      "Insert a layer item (sticky note) into a step. Validates layer_category against the parent blueprint's state_type; mismatch is a 400 Bad Request error.",
    inputSchema: {
      type: "object",
      properties: {
        step_id: { type: "number" },
        layer_category: {
          type: "string",
          enum: ["TOUCHPOINT", "ROLE", "TECHNOLOGY", "POLICY", "PROCESS", "METRIC", "CRITICAL_MOMENT", "OPPORTUNITY", "RATIONALE", "POTENTIAL_PITFALL"],
        },
        content: { type: "string", description: "Text-only content (no binary/data URIs)" },
        owner_id: { type: "string", description: "Optional owner identifier" },
      },
      required: ["step_id", "layer_category", "content"],
    },
  },
  {
    name: "export_action_plan",
    description:
      "Export all CRITICAL_MOMENT, OPPORTUNITY and POTENTIAL_PITFALL items; each entry bundles the item, its parent step details (title, is_visible, display_order, phase name) and ALL sibling layer items on that step.",
    inputSchema: {
      type: "object",
      properties: { blueprint_id: { type: "number" } },
      required: ["blueprint_id"],
    },
  },
  {
    name: "list_blueprints",
    description: "List all blueprints (id, name, state_type, version).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_blueprint",
    description: "Create a blueprint. state_type must be CURRENT_STATE or FUTURE_STATE.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        state_type: { type: "string", enum: ["CURRENT_STATE", "FUTURE_STATE"] },
      },
      required: ["name", "state_type"],
    },
  },
  {
    name: "delete_blueprint",
    description:
      "Erase a blueprint and all its phases, steps and layer items (cascade). This is irreversible.",
    inputSchema: {
      type: "object",
      properties: { blueprint_id: { type: "number" } },
      required: ["blueprint_id"],
    },
  },
  {
    name: "create_phase",
    description: "Add a phase to a blueprint. The phase is appended after existing phases.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        name: { type: "string" },
      },
      required: ["blueprint_id", "name"],
    },
  },
  {
    name: "update_phase",
    description: "Rename a phase.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        phase_id: { type: "number" },
        name: { type: "string" },
      },
      required: ["blueprint_id", "phase_id", "name"],
    },
  },
  {
    name: "delete_phase",
    description:
      "Erase a phase and (cascade) its steps and layer items.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        phase_id: { type: "number" },
      },
      required: ["blueprint_id", "phase_id"],
    },
  },
  {
    name: "create_step",
    description: "Add a step to a phase. The step is appended after the phase's existing steps.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        phase_id: { type: "number" },
        title: { type: "string" },
        is_visible: { type: "boolean", description: "Optional; default true" },
      },
      required: ["blueprint_id", "phase_id", "title"],
    },
  },
  {
    name: "update_step",
    description: "Patch a step's title and/or is_visible.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        step_id: { type: "number" },
        title: { type: "string" },
        is_visible: { type: "boolean" },
      },
      required: ["blueprint_id", "step_id"],
    },
  },
  {
    name: "delete_step",
    description: "Erase a step and its layer items.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        step_id: { type: "number" },
      },
      required: ["blueprint_id", "step_id"],
    },
  },
  {
    name: "update_layer_item",
    description: "Patch a layer item's content (text-only gate applies).",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        layer_item_id: { type: "number" },
        content: { type: "string" },
      },
      required: ["blueprint_id", "layer_item_id", "content"],
    },
  },
  {
    name: "delete_layer_item",
    description: "Erase a layer item.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        layer_item_id: { type: "number" },
      },
      required: ["blueprint_id", "layer_item_id"],
    },
  },
  {
    name: "reorder_steps",
    description:
      "Set display_order for steps in a blueprint. steps is an array of {id, display_order}; every id must belong to the blueprint.",
    inputSchema: {
      type: "object",
      properties: {
        blueprint_id: { type: "number" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "number" }, display_order: { type: "number" } },
            required: ["id", "display_order"],
          },
        },
      },
      required: ["blueprint_id", "steps"],
    },
  },
];

function dispatchTool(name, args) {
  switch (name) {
    case "get_blueprint_schema": return toolGetBlueprintSchema(args);
    case "add_layer_item": return toolAddLayerItem(args);
    case "export_action_plan": return toolExportActionPlan(args);
    case "list_blueprints": return toolListBlueprints(args);
    case "create_blueprint": return toolCreateBlueprint(args);
    case "delete_blueprint": return toolDeleteBlueprint(args);
    case "create_phase": return toolCreatePhase(args);
    case "update_phase": return toolUpdatePhase(args);
    case "delete_phase": return toolDeletePhase(args);
    case "create_step": return toolCreateStep(args);
    case "update_step": return toolUpdateStep(args);
    case "delete_step": return toolDeleteStep(args);
    case "update_layer_item": return toolUpdateLayerItem(args);
    case "delete_layer_item": return toolDeleteLayerItem(args);
    case "reorder_steps": return toolReorderSteps(args);
    default:
      return { error: true, code: -32602, message: `unknown tool '${name}'` };
  }
}

// --- JSON-RPC request loop ---------------------------------------------------------

const rpcMethods = {
  initialize(id) {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "business-blueprints-mcp", version: "1.0.0" },
    };
  },
  "tools/list"(id) {
    return { tools: TOOLS };
  },
  "tools/call"(id, params) {
    try {
      const result = dispatchTool(params.name, params.arguments || {});
      if (result && result.error) return { error: { code: result.code, message: result.message } };
      return result;
    } catch (err) {
      // Map HTTP-style semantics: "400 Bad Request: ..." → JSON-RPC -32600.
      if (/^400 Bad Request/.test(err.message)) {
        return { error: { code: -32600, message: err.message } };
      }
      if (/^404 Not Found/.test(err.message)) {
        return { error: { code: -32600, message: err.message } };
      }
      return { error: { code: -32603, message: err.message } };
    }
  },
};

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  const handler = rpcMethods[msg.method];
  if (!handler) {
    if (msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
    }
    return;
  }
  const outcome = handler(msg.id, msg.params);
  if (msg.id !== undefined) {
    if (outcome && outcome.error) {
      send({ jsonrpc: "2.0", id: msg.id, error: outcome.error });
    } else {
      send({ jsonrpc: "2.0", id: msg.id, result: outcome });
    }
  }
});
rl.on("close", () => process.exit(0));
