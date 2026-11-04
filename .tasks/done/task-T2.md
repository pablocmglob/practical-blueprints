# T2 — Backend & MCP server (T-101-A)

State: Done
Owner: plan-implementer (worktree `coda/backend-mcp`)
Created: 2026-11-03
Spec: `docs/implementation/backend_spec.md` (strict architectural guideline)

## Brief

Build the data layer, CRUD API, real-time channel, and MCP server per
`docs/implementation/backend_spec.md`:

- **Schema** (node:sqlite, no external deps): `blueprints` (`state_type`
  ENUM CURRENT_STATE/FUTURE_STATE), `phases` (`display_order`), `steps`
  (`is_visible` frontstage/backstage, `display_order`), `layer_items`
  (`layer_category` ENUM, `content` TEXT-only, optional `owner_id`).
  Layer categories: core TOUCHPOINT/ROLE/TECHNOLOGY/POLICY/PROCESS;
  current-only METRIC/CRITICAL_MOMENT/OPPORTUNITY; future-only
  RATIONALE/POTENTIAL_PITFALL.
- **CRUD API**: `POST /api/blueprints/{id}/phases`, `.../steps`,
  `.../layer-items` (+ read/list/delete for a usable board). Optimistic
  concurrency via version/ETag on mutations.
- **Real-time**: SSE stream per blueprint; every mutation broadcasts so
  MCP-injected changes appear in the UI without refresh.
- **MCP tools**: `get_blueprint_schema(blueprint_id)` (full hierarchical
  JSON), `add_layer_item(step_id, layer_category, content)` (MUST validate
  category vs blueprint `state_type` → 400 on mismatch), and
  `export_action_plan(blueprint_id)` (all CRITICAL_MOMENT/OPPORTUNITY/
  POTENTIAL_PITFALL items, each bundled with parent step details and ALL
  sibling layer items on that step).
- **Text-only enforcement**: reject binary/media content at the API and
  MCP boundary.

## Done when

- Server runs with `node server/index.js`; schema auto-creates on boot.
- All endpoints + 3 MCP tools behave per spec (state gate, contextual
  export, text-only rejection).
- QA suite (T4) passes against the running server.
- Behaviour reference updated in the same change.
