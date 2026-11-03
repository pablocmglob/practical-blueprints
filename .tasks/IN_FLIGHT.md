# In flight — the task queue

`.tasks/` is THE only work queue (see `.agents/rules/task-specs.md`).

- Task files live at this level: `task-<id>.md`. State is inside the file
  (To Do / In Progress / Done).
- First call of every session: read this file and scan the directory; claim
  a task before working it.
- No task file yet? Create one before you start, no exception for small work.
- Allocate ids by FILE CREATION: probe → create `.tasks/task-<id>.md` →
  verify exactly one file with that name.
- Done tasks move to `.tasks/done/`. `.tasks/archive/` is frozen read-only.
