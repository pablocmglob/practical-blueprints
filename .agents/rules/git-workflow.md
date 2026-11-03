# Topic rule: git workflow

History: `docs/amendments/2026-11-03-git-workflow.md` — read it when a push
conflict, a worktree question, or a commit-scope dispute comes up.

## Branching and pushing

- All agent work goes to **main**. There are no long-lived feature branches;
  a session may push its assigned `coda/<slug>` ref at the same SHA for
  traceability, but main is the destination.
- **Never force-push main.** Non-fast-forward → fetch, rebase, re-run the
  gate, retry.
- Worktrees are local scratch (`.wt/<name>`): merge or discard each before
  the turn ends; never push them, never commit them.
- Everything lives in the repo; commit before you stop. A cloud container
  loses uncommitted work.

## Commits

- **Hunk-scope commits with explicit paths; never `git add -A`.** The tree is
  shared with other sessions and the operator; `git add -A` can sweep up
  another session's half-finished work.
- Functional commit subjects end with the task id in parentheses: `(T12)` or
  `(T12+T13)`. Docs/chore/ci-only commits are exempt. An agent refuses to
  make a functional commit without an id.
- Commit before stopping; the repo is the only durable state.

## The gate

A passing full test suite is a MANDATORY push gate: compile, build the
frontend if it changed, run the whole suite. "The failure was pre-existing"
is not an excuse: fix it. Database-only tests run against a throwaway local
store with session-unique paths, never a shared database. Never point a
database URL at a shared environment: the suite seeds, deletes and migrates.
