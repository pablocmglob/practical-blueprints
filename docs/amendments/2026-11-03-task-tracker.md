# Amendment 2026-11-03 — task tracker adopted

- `.tasks/` chosen as the internal queue: repo-based, no external tool, works
  in any harness and any container.
- Ids are allocated by FILE CREATION (probe → create → verify exactly one),
  not by counting, so two sessions cannot collide or overwrite each other's
  task.
- `.tasks/archive/` is frozen and read-only; a policy test fails if a task is
  added there.
- Functional commit subjects carry the task id; docs/chore/ci-only commits
  are exempt.
