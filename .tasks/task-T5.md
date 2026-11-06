# T5 — MCP server: expose every UI editing action as tools

State: Done
Owner: session (operator request)
Created: 2026-11-03

## Brief

The MCP stdio server (`server/mcp.js`) currently exposes only 3 tools
(get_blueprint_schema, add_layer_item, export_action_plan), while the web UI
can create/delete blueprints, add/rename/delete phases and steps, edit and
delete layer items, and reorder. This task expands the MCP tool surface so an
MCP client can do everything the web interface can: create, edit and erase
blueprints and all their children.

## Spec change

None (no corpus/spec change; backend capability extension).

## Acceptance

- `tools/list` returns the full editing surface: list/create/delete blueprint,
  create/update/delete phase, create/update/delete step, update/delete layer
  item, reorder, plus the existing 3 tools.
- Every mutation uses the shared validators (state gate, text-only) and bumps
  the blueprint version.
- Every mutation POSTs to the notify bridge so SSE subscribers update live.
- New QA test `tests/qa/mcp_full_surface.test.js` executes the full surface
  against a live server + scratch DB (seed → call → read back → assert).
- Behaviour reference + changelog updated.
- Full gate green.
