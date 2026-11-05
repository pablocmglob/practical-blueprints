# SSOT registry — full rows

Companion to `.agents/rules/ssot-registry.md` (the short table lives there).
One row per fact: writer, readers, edge cases, regression tests.

| Concern | Canonical location | Writer | Readers | Edge cases | Regression tests |
| --- | --- | --- | --- | --- | --- |
| Blueprint corpus | `blueprints/` | operator / planned removals only | `tools/validate.py`, `tools/index.py` | file removed without a plan → HR-1 violation | `tests/policy/test_corpus_integrity.js` |
| Blueprint schema | `schema/blueprints.schema.json` | planned schema changes | `tools/validate.py`, generators | schema drift vs corpus → L7 test | `tests/policy/test_schema_drift.js` |
| Validity decision | `tools/validate.py` | planned validator changes | `tools/index.py`, CI gate | parallel validator → HR-3 | `tests/policy/test_ssot_pins.js` |
| Published index | `index/blueprints.json` | `tools/index.py` only | consumers of the published index | duplicate ids → error, write nothing | `tests/policy/test_index_idempotent.js` |
| Task queue | `.tasks/` | sessions (file creation) | every session, first call | id race → create-then-verify | `tests/policy/test_frozen_archive.js` |
| Behaviour truth | `docs/BEHAVIOUR_REFERENCE.md` | implementers, same change as code | planner, adversary, reviewers | code/doc disagreement → bug, converge in same change | `tests/policy/test_doc_coupling.js` |
| Hard Rules text | `docs/HARD_RULES_HISTORY.md` | amendments only (strengthen or refuse) | hard-rule-auditor | weakening edit → blocked | `tests/policy/test_hard_rules_pins.js` |
| Default-off switches | `docs/flags_default_off.json` | plans that ship a switch OFF | tests, reviewers | OFF default without entry → fail; stale entry → fail | `tests/policy/test_flags_registry.js` |
