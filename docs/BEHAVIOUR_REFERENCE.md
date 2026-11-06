# Behaviour reference — what every entry point ACTUALLY does today

Created: 2026-11-03. Format per entry: **Inputs / Returns / Side effects /
Edge cases**. If an entry and the code disagree, that is a bug: one converges
to the other in the same change, never silently.

> This reference starts small because the codebase starts small. Every new
> method or tool entry point adds its entry here in the same change.

---

## `tools/gen_agents.py`

**Inputs:** `--write` (render generated files) or `--check` (verify rendered
files match; exit 1 on drift). Scans `.agents/roles/*.md` and
`.coda/agents/`.

**Returns:** exit 0 on success; exit 1 with a list of drifted/missing files
on `--check`.

**Side effects:** with `--write`, creates/overwrites `.coda/agents/<name>.md`
for each role file. Never touches role files.

**Edge cases:** a role file without `name:` frontmatter is an error (exit 2);
a generated file with no matching role is reported as orphaned on `--check`.

## `tools/validate.py`

**Inputs:** `--corpus <dir>` (default `blueprints/`), `--schema <file>`
(default `schema/blueprints.schema.json`), optional `--report <file>`.

**Returns:** exit 0 if all pass; exit 1 with one error line per failure.

**Side effects:** none on the corpus (read-only by design — HR-1).

**Edge cases:** missing schema file → raise, write nothing (HR-5); a file
that is not valid JSON → precise error naming the file and the problem.

## `tools/index.py`

**Inputs:** `--corpus <dir>` (default `blueprints/`), `--out <file>` (default
`index/blueprints.json`).

**Returns:** exit 0; prints a one-line summary (n blueprints indexed).

**Side effects:** writes the index file. Idempotent: same corpus → same
bytes. Additive: never deletes entries not covered by the current corpus
(HR-4).

**Edge cases:** empty corpus → writes an empty index (valid state); duplicate
ids in the corpus → error, writes nothing (HR-5).

## `tools/run_tests.py`

**Inputs:** optional path filter; default runs the whole suite.

**Returns:** exit 0 if all pass; exit 1 with the failing test names.

**Side effects:** none beyond the tests themselves; policy tests read repo
files only.

**Edge cases:** a missing required file (e.g. AGENTS.md) fails the relevant
policy test with a clear message, not a crash.


---

## `server/db.js` — data layer (T2)

**Inputs:** `openDatabase(dbPath?)` — path defaults to `BB_DB_PATH` env, then
`server/blueprints.db`. Schema (blueprints / phases / steps / layer_items)
auto-creates on boot; `PRAGMA foreign_keys = ON`.

**Returns:** module exports the shared validators and query helpers:
`validateLayerCategory(stateType, category)`, `validateTextContent(content)`,
`getBlueprintHierarchy(db, id)` (blueprint → phases → steps → layer_items),
`bumpVersion(db, id)`.

**Side effects:** creates the DB file and directory if missing. No deletion.

**Edge cases:** `validateLayerCategory` is THE single state gate — both the
REST API and the MCP tools call the same function, so the gate cannot drift
between entry points. Core categories (TOUCHPOINT/ROLE/TECHNOLOGY/POLICY/
PROCESS) are valid for both state types; METRIC/CRITICAL_MOMENT/OPPORTUNITY
only for CURRENT_STATE; RATIONALE/POTENTIAL_PITFALL only for FUTURE_STATE.
`validateTextContent` rejects data: URIs, base64 runs (≥40 chars, no
spaces), control
characters (beyond \n \t \r) and content > 10000 chars; newline/tab/CR pass.

## `server/index.js` — HTTP server (T2)

**Inputs:** `node server/index.js` (env: `PORT` default 8787, `BB_DB_PATH`).
Plain node:http; serves static files from `ui/` (index.html at `/`).

**Returns / endpoints:**
- `POST /api/blueprints` `{name, state_type}` → 201 blueprint (version 1).
- `GET /api/blueprints` → 200 array.
- `GET /api/blueprints/{id}` → 200 full hierarchical JSON; `ETag` = version.
- `POST /api/blueprints/{id}/phases` `{name[, display_order]}` → 201
  `{phase, version}`.
- `POST /api/blueprints/{id}/steps` `{phase_id, title, is_visible[,
  display_order]}` → 201 `{step, version}`.
- `POST /api/blueprints/{id}/layer-items` `{step_id, layer_category, content[
  , owner_id]}` → 201 `{layer_item, version}`.
- `DELETE /api/blueprints/{id}/(phases|steps|layer-items)/{childId}` → 200
  `{deleted, version}`.
- `GET /api/blueprints/{id}/events` → SSE stream (`event:` + `data:` JSON per
  mutation).
- `POST /api/blueprints/{id}/notify` → internal cross-process route (not part
  of the public contract): the MCP stdio server POSTs mutation events here so
  they reach this process's SSE subscribers.

**Side effects:** every successful mutation bumps the blueprint `version`,
broadcasts a JSON event to all SSE subscribers of that blueprint, and touches
`updated_at`.

**Edge cases:**
- *Optimistic concurrency:* mutations require `If-Match: <version>` (or
  `body.version`); missing → 428 with `current_version`; stale → 409 with
  `current_version`; success bumps version and returns the new one. 400
  validation errors on layer-items also carry `current_version` so clients
  can re-sync.
- *State gate:* category-vs-state_type mismatch → 400 (shared validator).
- *Text-only:* data: URI / base64 blob / control chars → 400.
- Unknown route → 404; invalid JSON body → 400; body > 1 MB → 413.
- Static path traversal outside `ui/` → 403.

## `server/mcp.js` — MCP server over stdio (T2)

**Inputs:** `node server/mcp.js` — newline-delimited JSON-RPC 2.0 on stdio;
methods `initialize`, `tools/list`, `tools/call` (plus
`notifications/initialized`, ignored). Uses the same database as the HTTP
server (`BB_DB_PATH` / `server/blueprints.db`).

**Returns:** the full editing surface of the web UI as tools:
- `get_blueprint_schema(blueprint_id)` → full hierarchical JSON.
- `add_layer_item(step_id, layer_category, content[, owner_id])` → validates
  category vs the parent blueprint's state_type with the SAME shared
  validator as the REST API; mismatch → JSON-RPC error code `-32600` with
  message `"400 Bad Request: ..."`; missing step → `-32600` "400 Bad
  Request: step N not found"; success → `{layer_item, version}` and an SSE
  broadcast (`source: "mcp"`) so live UIs update without refresh.
- `export_action_plan(blueprint_id)` → `{blueprint_id, blueprint_name,
  state_type, entries[]}`; every CRITICAL_MOMENT / OPPORTUNITY /
  POTENTIAL_PITFALL item becomes one entry bundling `item`, `step` (id,
  title, is_visible, display_order, phase_name) and `sibling_items` (ALL
  other layer items on that step).
- Blueprint lifecycle (T5): `list_blueprints()` → all rows;
  `create_blueprint(name, state_type)` → `{blueprint, version}`;
  `delete_blueprint(blueprint_id)` → cascade erase, irreversible.
- Phases (T5): `create_phase(blueprint_id, name)` (appended);
  `update_phase(blueprint_id, phase_id, name)` (rename);
  `delete_phase(blueprint_id, phase_id)` (cascade).
- Steps (T5): `create_step(blueprint_id, phase_id, title[, is_visible])`
  (appended within the phase); `update_step(blueprint_id, step_id[, title][,
  is_visible])`; `delete_step(blueprint_id, step_id)`.
- Layer items (T5): `update_layer_item(blueprint_id, layer_item_id, content)`
  (text-only gate applies); `delete_layer_item(blueprint_id, layer_item_id)`.
- Ordering (T5): `reorder_steps(blueprint_id, steps[{id, display_order}])` —
  every id must belong to the blueprint.

**Side effects:** every mutation inserts/updates/deletes and bumps the
blueprint version (observable by the REST API's next If-Match), and POSTs
the event to the notify bridge (`source: "mcp"`) so SSE subscribers update
live.

**Edge cases:** unknown tool → `-32602`; HTTP-400-semantics failures map to
`-32600` with the "400 Bad Request: ..." message; 404s also map to `-32600`;
other errors → `-32603`. If the HTTP server is not running, SSE broadcast is
a no-op (MCP-only usage still works).

## `server/seed.js` — demo data (T2)

**Inputs:** `node server/seed.js` (env: `BB_DB_PATH`).

**Returns:** exit 0; prints the created blueprint id.

**Side effects:** creates a CURRENT_STATE demo blueprint ("Demo — Coffee
Shop Customer Visit") with 2 phases, 4 steps (one backstage) and 14 layer
items across core + current-only categories.

**Edge cases:** idempotent — if the demo blueprint name already exists, it
prints and exits without duplicating.

## `tests/smoke_backend.js` — backend smoke test (T2)

**Inputs:** `node tests/smoke_backend.js`. Boots the server on a random
scratch port + scratch DB (no repo files touched).

**Returns:** exit 0 when all checks pass; exit 1 listing failures.

**Side effects:** writes only to a temp dir; kills the server at the end.

**Edge cases:** covers create/list/get, phase/step/layer-item creation,
stale If-Match → 409, state gate 400 both directions, data-URI and control
char rejection, newline/tab acceptance, SSE broadcast, ETag=version, DELETE,
404s, and all three MCP tools over stdio.
## `ui/` — Canvas UI (T3)

Static frontend served by the backend at `/` (plain HTML/CSS/JS, no
frameworks, no build step, no external dependencies).

**Inputs:** the read-only API shapes — `GET /api/blueprints`,
`GET /api/blueprints/{id}` (hierarchical: blueprint → phases → steps →
layer_items; `step.is_visible` true = frontstage), `POST
/api/blueprints/{id}/layer-items` with `If-Match: <version>`, and the SSE
stream `GET /api/blueprints/{id}/events`.

**Returns (what it renders):** a single linear canvas — X axis = phases
grouped over steps in sequence, Y axis = the ten layer categories
(TOUCHPOINT, ROLE, TECHNOLOGY, POLICY, PROCESS, METRIC, CRITICAL_MOMENT,
OPPORTUNITY, RATIONALE, POTENTIAL_PITFALL). Step-column × category-row
intersections are drop-zones for text sticky notes. Frontstage steps render
light, backstage dark; categories are strictly color-coded (Roles=Green,
Touchpoints=Blue, Policies=Orange, Critical Moments=Red, Opportunities=
Yellow, plus fixed colors for the rest). Columns widen as items stack
(heat map, capped at 2.5× base width). Sticky top header (phase/step names)
and sticky left row labels (category names) with horizontal/vertical
scrolling for large blueprints.

**Side effects:** submitting a sidebar prompt or dropping text on a cell
POSTs a layer item with the current version as `If-Match`; the response's
new version is tracked for the next mutation. SSE events trigger a
re-fetch + re-render without page refresh.

**Edge cases:** text-only enforcement — file drag-drop and non-text paste
are intercepted and rejected with a visible toast; empty/oversized (>2000
chars) note text is rejected client-side; unknown layer categories in API
data are skipped; missing/failed API → empty-state message and offline
status, no crash. No branching UI, graphs, or variant toggles exist
anywhere; no file inputs exist anywhere.

**Verification:** `node --test tests/ui/` (plain Node, no dependencies).
`tests/ui/mock-server.js` stubs the API contract (including SSE) and can
also be run standalone — `node tests/ui/mock-server.js [port]` — to serve
`ui/` for manual browser checks.

