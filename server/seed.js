/** seed.js — create a small demo CURRENT_STATE blueprint so the UI and QA
 * have data. Idempotent: skips seeding when the demo blueprint already exists.
 *
 * Run: node server/seed.js   (env: BB_DB_PATH to target a specific database)
 */
"use strict";

const {
  openDatabase,
  getBlueprint,
  bumpVersion,
  validateLayerCategory,
} = require("./db");

const DEMO_NAME = "Demo — Coffee Shop Customer Visit (Current State)";

function seed(dbPath) {
  const db = openDatabase(dbPath);
  const existing = db.prepare("SELECT * FROM blueprints WHERE name = ?").get(DEMO_NAME);
  if (existing) {
    console.log(`seed: demo blueprint already exists (id ${existing.id}); nothing to do`);
    return existing.id;
  }

  const bpResult = db
    .prepare("INSERT INTO blueprints (name, state_type) VALUES (?, 'CURRENT_STATE')")
    .run(DEMO_NAME);
  const blueprintId = Number(bpResult.lastInsertRowid);

  const insertPhase = db.prepare("INSERT INTO phases (blueprint_id, name, display_order) VALUES (?, ?, ?)");
  const insertStep = db.prepare("INSERT INTO steps (phase_id, title, is_visible, display_order) VALUES (?, ?, ?, ?)");
  const insertItem = db.prepare("INSERT INTO layer_items (step_id, layer_category, content, owner_id) VALUES (?, ?, ?, ?)");

  const addItem = (stepId, category, content, ownerId) => {
    const check = validateLayerCategory("CURRENT_STATE", category);
    if (!check.ok) throw new Error(`seed bug: ${check.reason}`);
    insertItem.run(stepId, category, content, ownerId || null);
  };

  // Phase 1 — Arrival & Order
  const phase1 = Number(insertPhase.run(blueprintId, "Arrival & Order", 0).lastInsertRowid);
  const step1 = Number(insertStep.run(phase1, "Enter the shop", 1, 0).lastInsertRowid);
  const step2 = Number(insertStep.run(phase1, "Order at the counter", 1, 1).lastInsertRowid);
  const step3 = Number(insertStep.run(phase1, "Prepare the order", 0, 2).lastInsertRowid); // backstage

  addItem(step1, "TOUCHPOINT", "Storefront entrance and menu board");
  addItem(step1, "ROLE", "Greeter (peak hours only)");
  addItem(step1, "METRIC", "Walk-in foot traffic per hour");
  addItem(step1, "CRITICAL_MOMENT", "First impression of wait time — customer decides to stay or leave");

  addItem(step2, "TOUCHPOINT", "Counter POS terminal");
  addItem(step2, "TECHNOLOGY", "Loyalty card scanner");
  addItem(step2, "POLICY", "No split payments on loyalty + cash");
  addItem(step2, "OPPORTUNITY", "Mobile pre-order to skip the queue");

  addItem(step3, "PROCESS", "Barista hand-off protocol");
  addItem(step3, "TECHNOLOGY", "Espresso machine (single station)");
  addItem(step3, "METRIC", "Average drink preparation time (min)");

  // Phase 2 — Enjoy & Return
  const phase2 = Number(insertPhase.run(blueprintId, "Enjoy & Return", 1).lastInsertRowid);
  const step4 = Number(insertStep.run(phase2, "Find a seat and enjoy", 1, 0).lastInsertRowid);

  addItem(step4, "TOUCHPOINT", "Seating area and Wi-Fi");
  addItem(step4, "CRITICAL_MOMENT", "No free table at peak hours — walk-out risk");
  addItem(step4, "OPPORTUNITY", "Reservation board for community tables");

  const version = bumpVersion(db, blueprintId);
  console.log(`seed: created blueprint ${blueprintId} "${DEMO_NAME}" (version ${version})`);
  console.log(`seed: 2 phases, 4 steps, 14 layer items`);
  return blueprintId;
}

if (require.main === module) {
  const id = seed();
  process.exit(0);
}

module.exports = { seed, DEMO_NAME };
