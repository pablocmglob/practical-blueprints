# Adversary & QA Testing Specification (T-101-C)

## 1. Data Integrity & Safety Gate Checks
- **Schema Validation**: Attempt to write a `CRITICAL_MOMENT` to a `FUTURE_STATE` blueprint via the MCP endpoint. The safety gate MUST block this and return a 400 Bad Request.
- **Contextual Export Validation**: Call the `export_action_plan` MCP tool and verify that the payload includes not just the target insights, but also the sibling layer items (Roles, Systems, Touchpoints) associated with their parent steps.
- **Single Source of Truth**: Verify that external task specs (`.tasks/IN_FLIGHT.md`) and the database remain in sync. Changes to the blueprint state must trigger a unified commit hook.

## 2. Concurrency & Race Conditions
- **Simultaneous Writes**: Simulate an MCP agent calling `add_layer_item` simultaneously while a human user modifies the same `step_id` via the Web UI. Ensure optimistic concurrency control (e.g., ETag/Version tracking) prevents swallowed updates.
- **WebSocket Drift**: Ensure that all clients connected to the Web UI immediately reflect changes injected via the MCP server without requiring a hard refresh.

## 3. UI Edge Cases
- **File Upload Rejection**: Attempt to drag and drop an image or PDF into a Touchpoint sticky note. Verify the UI rejects the action and enforces text-only inputs.
- **Extreme Heat Map Load**: Generate a blueprint with 50+ steps and 20+ layer items stacked under a single step. Verify that CSS Grid rendering does not break, overflow is handled via smooth scrolling, and sticky headers/row labels remain in the viewport.
