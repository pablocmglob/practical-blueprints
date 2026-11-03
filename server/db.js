/** db.js — SQLite data layer for the Practical Blueprinting backend.
 *
 * Uses node:sqlite (no external dependencies). The schema auto-creates on
 * boot. Exposes the ONE shared layer-category validator used by BOTH the
 * REST API (server/index.js) and the MCP tools (server/mcp.js), so the
 * state gate cannot drift between the two entry points.
 */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

// --- Layer category registry (single source of truth) -----------------------

const CORE_CATEGORIES = ["TOUCHPOINT", "ROLE", "TECHNOLOGY", "POLICY", "PROCESS"];
const CURRENT_ONLY_CATEGORIES = ["METRIC", "CRITICAL_MOMENT", "OPPORTUNITY"];
const FUTURE_ONLY_CATEGORIES = ["RATIONALE", "POTENTIAL_PITFALL"];
const ALL_CATEGORIES = [...CORE_CATEGORIES, ...CURRENT_ONLY_CATEGORIES, ...FUTURE_ONLY_CATEGORIES];

const STATE_TYPES = ["CURRENT_STATE", "FUTURE_STATE"];

/**
 * Validate a layer category against a blueprint's state_type.
 * THE shared gate: both the REST API and the MCP tools call this.
 *
 * @param {string} stateType  'CURRENT_STATE' | 'FUTURE_STATE'
 * @param {string} category   one of ALL_CATEGORIES
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function validateLayerCategory(stateType, category) {
  if (!ALL_CATEGORIES.includes(category)) {
    return { ok: false, reason: `unknown layer_category '${category}'` };
  }
  if (CORE_CATEGORIES.includes(category)) return { ok: true };
  if (stateType === "CURRENT_STATE" && CURRENT_ONLY_CATEGORIES.includes(category)) return { ok: true };
  if (stateType === "FUTURE_STATE" && FUTURE_ONLY_CATEGORIES.includes(category)) return { ok: true };
  return {
    ok: false,
    reason: `layer_category '${category}' is not valid for a ${stateType} blueprint`,
  };
}

/**
 * Text-only enforcement: reject binary/media content. Allowed: printable
 * text, newline (\n), tab (\t), carriage return (\r). Rejected: data: URIs,
 * long base64 blobs, and any other control characters.
 * @param {string} content
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function validateTextContent(content) {
  if (typeof content !== "string") {
    return { ok: false, reason: "content must be a string" };
  }
  if (content.length > 10000) {
    return { ok: false, reason: "content exceeds 10000 characters" };
  }
  if (/data:[\w.+-]+\/[\w.+-]+;base64,/i.test(content)) {
    return { ok: false, reason: "data: URIs (binary content) are not allowed; text only" };
  }
  // Long base64-looking runs (>= 100 chars of base64 alphabet, no spaces)
  if (/[A-Za-z0-9+/]{100,}={0,2}/.test(content)) {
    return { ok: false, reason: "base64 blobs are not allowed; text only" };
  }
  // Control characters beyond \n \t \r
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content)) {
    return { ok: false, reason: "control characters are not allowed; text only" };
  }
  return { ok: true };
}

// --- Schema -----------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS blueprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  state_type TEXT NOT NULL CHECK (state_type IN ('CURRENT_STATE','FUTURE_STATE')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blueprint_id INTEGER NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_visible INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS layer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  layer_category TEXT NOT NULL,
  content TEXT NOT NULL,
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_phases_blueprint ON phases(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_steps_phase ON steps(phase_id);
CREATE INDEX IF NOT EXISTS idx_layer_items_step ON layer_items(step_id);
`;

/**
 * Open (and auto-create) the database.
 * @param {string} [dbPath] defaults to BB_DB_PATH env or <repo>/server/blueprints.db
 */
function openDatabase(dbPath) {
  const resolved = dbPath || process.env.BB_DB_PATH || path.join(__dirname, "blueprints.db");
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  return db;
}

// --- Queries shared by REST and MCP ------------------------------------------

function getBlueprint(db, id) {
  return db.prepare("SELECT * FROM blueprints WHERE id = ?").get(id) || null;
}

function getStepWithBlueprint(db, stepId) {
  return (
    db
      .prepare(
        `SELECT s.*, p.blueprint_id, p.name AS phase_name, p.display_order AS phase_display_order
         FROM steps s JOIN phases p ON p.id = s.phase_id WHERE s.id = ?`
      )
      .get(stepId) || null
  );
}

function listPhases(db, blueprintId) {
  return db
    .prepare("SELECT * FROM phases WHERE blueprint_id = ? ORDER BY display_order, id")
    .all(blueprintId);
}

function listSteps(db, blueprintId) {
  return db
    .prepare(
      `SELECT s.* FROM steps s JOIN phases p ON p.id = s.phase_id
       WHERE p.blueprint_id = ? ORDER BY p.display_order, p.id, s.display_order, s.id`
    )
    .all(blueprintId);
}

function listLayerItems(db, blueprintId) {
  return db
    .prepare(
      `SELECT li.* FROM layer_items li
       JOIN steps s ON s.id = li.step_id
       JOIN phases p ON p.id = s.phase_id
       WHERE p.blueprint_id = ? ORDER BY li.id`
    )
    .all(blueprintId);
}

/** Full hierarchical JSON: blueprint → phases → steps → layer_items. */
function getBlueprintHierarchy(db, blueprintId) {
  const blueprint = getBlueprint(db, blueprintId);
  if (!blueprint) return null;
  const phases = listPhases(db, blueprintId);
  const steps = listSteps(db, blueprintId);
  const items = listLayerItems(db, blueprintId);
  return {
    ...blueprint,
    phases: phases.map((phase) => ({
      ...phase,
      steps: steps
        .filter((s) => s.phase_id === phase.id)
        .map((step) => ({
          ...step,
          layer_items: items.filter((li) => li.step_id === step.id),
        })),
    })),
  };
}

/** Bump the blueprint version and touch updated_at. Returns the new version. */
function bumpVersion(db, blueprintId) {
  db.prepare(
    "UPDATE blueprints SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(blueprintId);
  return getBlueprint(db, blueprintId).version;
}

module.exports = {
  CORE_CATEGORIES,
  CURRENT_ONLY_CATEGORIES,
  FUTURE_ONLY_CATEGORIES,
  ALL_CATEGORIES,
  STATE_TYPES,
  validateLayerCategory,
  validateTextContent,
  openDatabase,
  getBlueprint,
  getStepWithBlueprint,
  getBlueprintHierarchy,
  bumpVersion,
};
