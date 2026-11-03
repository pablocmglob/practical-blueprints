# Topic rule: testing and docs

History: `docs/amendments/2026-11-03-testing-layers.md` — read it when a test
fails oddly or a layer question comes up.

## Required-reading triad

1. `docs/DESIGN_INTENT.md` — what the system SHOULD do.
2. `docs/BEHAVIOUR_REFERENCE.md` — what every method ACTUALLY does today:
   Inputs / Returns / Side effects / Edge cases per entry.
3. `docs/BEHAVIOUR_CHANGELOG.md` — dated audit trail.

If the reference and the code disagree, that is a bug: one converges to the
other in the same change, never silently.

## Test layers (decision tree in tests/README.md)

- **L1** business invariants — the Hard Rules, deployment blockers
- **L2** SSOT pins — the registry rows are true
- **L3** API contracts — public shapes (schema, index format)
- **L4** unit
- **L5** integration
- **L6** regression — one test per historical bug, named by its id
- **L7** schema — schema-column drift

## Docs coupling

A change to a guarded decision file (`tools/validate.py`, `tools/index.py`,
`schema/blueprints.schema.json`) with no change to the behaviour docs or
specs is refused: a policy test enforces doc coupling. Tests are additive: no
deletion, skip or weakening without an explicit changelog entry.

## The gate

Compile, build the frontend if it changed, run the whole suite in parallel.
A passing full suite is a MANDATORY push gate. Data-processing tests run
against throwaway local stores with session-unique paths, never a shared
database.
