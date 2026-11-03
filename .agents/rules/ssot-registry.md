# Topic rule: single-source-of-truth registry

Full table (writer, readers, edge cases, regression tests per row):
`docs/SSOT_REGISTRY.md`. History: `docs/amendments/2026-11-03-ssot.md`.

## Patterns to enforce

- **One writer per fact.** A second writer is a bug, not a convenience.
- Hot paths read an installed in-memory copy, never the table per tick.
- Analytics/capture tables are off the hot path.
- Write-once audit tables use `ON CONFLICT DO NOTHING` (or the file-system
  equivalent: create-new, never overwrite).
- Critical reads are strict: raise, write nothing on failure.

## Registry (concern → canonical location → one-line hard rule)

| Concern | Canonical location | One-line hard rule |
| --- | --- | --- |
| Blueprint corpus | `blueprints/` | Only `blueprints/` holds blueprint files; tools never copy them elsewhere. |
| Blueprint schema | `schema/blueprints.schema.json` | The schema file is the only definition of a valid blueprint; validators import it, never restate it. |
| Validity decision | `tools/validate.py` | Validation is a chokepoint: nothing enters the published index without passing it; no parallel validator. |
| Published index | `index/blueprints.json` | Only `tools/index.py` writes the index; re-runs are idempotent and additive. |
| Task queue | `.tasks/` | `.tasks/` is the only work queue; no second queue in code, chat or docs. |
| Behaviour truth | `docs/BEHAVIOUR_REFERENCE.md` | The reference is the only record of what methods do; code and it converge in the same change. |
| Hard Rules text | `docs/HARD_RULES_HISTORY.md` | The five Hard Rules are listed once, here and in AGENTS.md; any edit strengthens or is blocked. |
| Default-off switches | `docs/flags_default_off.json` | The registry is the only list of OFF-by-default switches; a test pins it. |

A new fact adds a row here AND in `docs/SSOT_REGISTRY.md` in the same change.
Pin the registry with a test layer (L2).
