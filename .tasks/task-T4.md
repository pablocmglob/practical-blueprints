# T4 — Adversary & QA gate (T-101-C)

State: In Progress
Owner: adversary (worktree `coda/qa-gate`)
Created: 2026-11-03
Spec: `docs/implementation/qa_spec.md` (strict architectural guideline)

## Brief

Build the automated QA suite per `docs/implementation/qa_spec.md`, targeting
the running server (T2) and UI (T3):

- **Data integrity**: write CRITICAL_MOMENT to a FUTURE_STATE blueprint via
  the MCP endpoint → MUST be blocked with 400. `export_action_plan` payload
  MUST include sibling layer items (Roles, Systems, Touchpoints) of each
  insight's parent step. Tracker (`.tasks/IN_FLIGHT.md`) and DB stay in sync
  via the unified commit hook rule.
- **Concurrency**: simultaneous MCP `add_layer_item` + human UI mutation on
  the same step → optimistic concurrency (ETag/version) prevents swallowed
  updates (409 on stale write, retry succeeds). SSE clients reflect
  MCP-injected changes without hard refresh.
- **UI edge cases**: drag-drop image/PDF into a Touchpoint note → rejected,
  text-only enforced. 50+ steps with 20+ items under one step → grid holds,
  smooth scrolling, sticky headers/row labels stay in viewport.

## Done when

- Suite lives in `tests/qa/`, runs headless with plain Node (no new deps).
- Red-first where behavioural: each attack demonstrated failing against a
  non-compliant implementation before the fix/subject existed.
- Full suite (policy + QA) green; results recorded in the behaviour
  reference in the same change.
