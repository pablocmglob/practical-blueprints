# tests/ — layer model and decision tree

The suite has seven layers. When you add a test, pick the lowest layer that
states the property; the decision tree tells you which.

| Layer | What it covers | Examples here |
| --- | --- | --- |
| **L1** business invariants | the Hard Rules, deployment blockers | `tests/policy/test_corpus_integrity.js`, `test_index_idempotent.js`, `test_strict_reads.js` |
| **L2** SSOT pins | registry rows are true | `tests/policy/test_ssot_pins.js` |
| **L3** API contracts | public shapes (schema, index format) | `tests/policy/test_schema_drift.js` (L3/L7) |
| **L4** unit | one function in isolation | future `tests/unit/` |
| **L5** integration | several parts together | `tests/smoke_backend.js` (guarded) |
| **L6** regression | one test per historical bug, named by its id | future `tests/regression/` |
| **L7** schema | schema-column drift | `tests/policy/test_schema_drift.js` |

## Decision tree

1. Does it state a Hard Rule or block deployment? → **L1**
2. Does it pin a fact's canonical location (one writer, chokepoint)? → **L2**
3. Does it pin a public shape (schema, index format)? → **L3**
4. Is it a historical bug? → **L6** (name it by the bug id)
5. Does it check schema/column shape? → **L7**
6. Several units together? → **L5**; one unit alone → **L4**

## Policy tests (enforcement, not prose)

In `tests/policy/`: AGENTS.md byte size, generated-agent drift, rules-file
byte size, frozen archive, published-specs marker, doc coupling, flags
registry, hard-rule pins, strict reads, index idempotence, corpus integrity,
schema drift, task-id in commit subjects.

Run everything with Node:

    "C:\Program Files\nodejs\node.exe" tools/run_tests.py

(The runner is plain Node, not Python — the name is kept for convention.)
