# Amendment 2026-11-03 — testing layers adopted

- Seven layers adopted (L1 invariants … L7 schema). Decision tree in
  `tests/README.md`.
- Policy tests live in the same suite as behaviour tests so CI is the
  backstop for the working organization itself.
- Doc coupling: a change to a guarded decision file with no change to the
  behaviour docs or specs is refused by `tests/policy/test_doc_coupling.py`.
