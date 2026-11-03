# Backend & MCP Implementation Specification (T-101-A)

## 1. Database Schema
To support the Practical Blueprint methodology, the data layer must reflect a hierarchical, strictly linear path. No complex branching graphs or variant toggling are supported; all scenarios are linear.

- **Blueprint**: `id`, `name`, `state_type` (ENUM: 'CURRENT_STATE', 'FUTURE_STATE'), `created_at`, `updated_at`.
- **Phase**: `id`, `blueprint_id`, `name`, `display_order`.
- **Step**: `id`, `phase_id`, `title`, `is_visible` (BOOLEAN: True for Frontstage, False for Backstage), `display_order`.
- **LayerItem**: `id`, `step_id`, `layer_category` (ENUM), `content` (TEXT - Text only, no binary file uploads), `owner_id` (OPTIONAL).

### Core Layer Categories (Available to all blueprints):
- TOUCHPOINT
- ROLE
- TECHNOLOGY
- POLICY
- PROCESS

### State-Specific Layer Categories:
- **Current-State Only**: METRIC, CRITICAL_MOMENT, OPPORTUNITY
- **Future-State Only**: RATIONALE, POTENTIAL_PITFALL

## 2. API Contract
Implement standard CRUD REST or GraphQL endpoints for real-time board collaboration:
- `POST /api/blueprints/{id}/phases`
- `POST /api/blueprints/{id}/steps`
- `POST /api/blueprints/{id}/layer-items`
Enable WebSockets or Server-Sent Events (SSE) for real-time collaboration across multiple user sessions.

## 3. MCP (Model Context Protocol) Server Requirements
The agent network requires direct programmatic access to the blueprint data to read configurations, insert findings, and extract synthesis plans.
- **`get_blueprint_schema(blueprint_id)`**: Returns the full hierarchical JSON of the blueprint.
- **`add_layer_item(step_id, layer_category, content)`**: Inserts a new sticky note into a specific step. Must validate that the `layer_category` matches the blueprint's `state_type`.
- **`export_action_plan(blueprint_id)`**: Extracts all `CRITICAL_MOMENT`, `OPPORTUNITY`, and `POTENTIAL_PITFALL` items. **Crucially, this payload must bundle all relevant context for each item**, meaning it must include the parent `Step` details and all sibling layer items (e.g., Roles, Systems, Policies) attached to that same step. This allows the downstream Synthesis Agent to evaluate root causes in a single call.
