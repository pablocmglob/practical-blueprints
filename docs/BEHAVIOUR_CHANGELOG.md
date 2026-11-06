# Behaviour changelog — dated audit trail

Append-only. One entry per behaviour change: date, what changed, which tests
state it, and any deviation from the plan.

## 2026-11-03

- **T1 — Initial setup of the multi-agent working organization.** Created the
  rules body (AGENTS.md + `.agents/rules/*.md` + CODA.md), role charters and
  generator (`tools/gen_agents.py`), hooks (`.coda/settings.json` +
  `.coda/hooks/`), the `.tasks/` tracker, the docs triad and registries, and
  the policy test suite. No blueprint corpus yet; validators are stubs whose
  behaviour is documented in `docs/BEHAVIOUR_REFERENCE.md`.
- Tests added: policy tests (see `tests/policy/`). Red-first records are in
  each implementer report; the drift test and the frozen-archive test were
  verified red before their subjects existed.

- **T2 — Backend & MCP server (T-101-A).** Added the data layer
  (`server/db.js`, node:sqlite, schema auto-create), the HTTP server
  (`server/index.js`: static `ui/`, REST CRUD under `/api/blueprints`,
  optimistic concurrency via If-Match/body.version → 409 with
  `current_version`, text-only enforcement, per-blueprint SSE stream with
  broadcast on every mutation), the stdio JSON-RPC MCP server
  (`server/mcp.js`: `get_blueprint_schema`, `add_layer_item` with the shared
  state gate mapped to `-32600` "400 Bad Request: ...", `export_action_plan`
  bundling parent step + all sibling items), and the idempotent demo seed
  (`server/seed.js`). The layer-category-vs-state_type gate lives in ONE
  shared function (`validateLayerCategory`) used by both REST and MCP.
- Tests added: `tests/smoke_backend.js` (25 checks, red-first: failed with
  "Cannot find module server/index.js" before implementation). Policy suite
  30/31 — the single failure (`gen_agents --check` drift) is pre-existing on
  the clean checkout (CRLF artifact) and belongs to the T1 file set.
- Docs: BEHAVIOUR_REFERENCE.md entries for db.js, index.js, mcp.js, seed.js,
  smoke_backend.js.

- **T5 — MCP full editing surface.** `server/mcp.js` now exposes every action
  performable by the web UI as MCP tools, in addition to the original three:
  `list_blueprints`, `create_blueprint`, `delete_blueprint` (cascade),
  `create_phase` / `update_phase` / `delete_phase` (cascade),
  `create_step` / `update_step` / `delete_step`,
  `update_layer_item` (text-only gate) / `delete_layer_item`, and
  `reorder_steps` (ownership-checked). Every mutation uses the shared
  validators, bumps the blueprint version, and POSTs to the notify bridge
  (`source: "mcp"`) so SSE subscribers update live.
- Tests added: `tests/qa/mcp_full_surface.test.js` (9 tests, red-first:
  failed with "missing MCP tool 'list_blueprints'" before implementation).
- Docs: BEHAVIOUR_REFERENCE.md `server/mcp.js` section rewritten for the
  full surface.
