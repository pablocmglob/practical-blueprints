# Topic rule: task tracker and spec workflow

History: `docs/amendments/2026-11-03-task-tracker.md` — read it when an id
allocation conflicts or a spec-publish question comes up.

## The tracker is the only queue

`.tasks/` inside this repository is THE queue. No external tools, no
machine-local state, no second queue anywhere.

- First call of every session: read `.tasks/IN_FLIGHT.md` and scan the
  directory; get the target task file before working it (the brief is in its
  details).
- No task file yet? Create one before you start, no exception for small work.
- Allocate ids by FILE CREATION, not by counting: probe → create
  `.tasks/task-<id>.md` → verify exactly one file with that name. A
  count-then-create race would silently destroy another session's task.
- Keep tasks true as state changes (To Do → In Progress → Done); on a stale
  write, merge into the current version and retry; never end a turn on a
  conflict. Before ending, every touched task sits in the right state.
- `.tasks/archive/` is a frozen, read-only archive of old items; a test fails
  if a task is added there.
- Confirm you are working in the RIGHT repo before the first write (project
  name in the root README).

## Task file format

```markdown
# T<id> — <title>

State: To Do | In Progress | Done
Owner: <session or agent>
Created: <date>

## Brief
<what and why>

## Spec change
<link to .specs/<change>/proposal.md, if any>

## Acceptance
- <testable condition>
```

## Spec workflow

One folder per change under `.specs/<change-id>/`: `proposal.md`, `specs/`,
`design.md`, `tasks.md`. `tasks.md` IS the task list — split into DISJOINT
file sets, one per implementer. The spec workflow wraps the PRE/POST
protocol. Publishing to the task tracker is a session step, never CI: a test
goes red when specs changed without the tracker reflecting it. Archive
merges deltas into living specs.
