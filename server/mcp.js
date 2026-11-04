/** mcp.js — MCP server over stdio (JSON-RPC 2.0), no external dependencies.
 *
 * Exposes exactly three tools:
 * - get_blueprint_schema(blueprint_id) → full hierarchical JSON
 * - add_layer_item(step_id, layer_category, content) → validates category vs
 *   the parent blueprint's state_type using the SAME shared validator as the
 *   REST API; mismatch → JSON-RPC error code -32600 with a "400 Bad Request:
 *   ..." message. Success broadcasts an SSE event so live UIs update.
 * - export_action_plan(blueprint_id) → all CRITICAL_MOMENT / OPPORTUNITY /
 *   POTENTIAL_PITFALL items, each bundled with parent step details and ALL
 *   sibling layer items on that step.
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
    }
  );
  req.on("error", () => {}); // HTTP server not running — no-op
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
];

function dispatchTool(name, args) {
  switch (name) {
    case "get_blueprint_schema": return toolGetBlueprintSchema(args);
    case "add_layer_item": return toolAddLayerItem(args);
    case "export_action_plan": return toolExportActionPlan(args);
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
