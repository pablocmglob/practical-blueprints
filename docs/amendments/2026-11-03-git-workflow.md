# Amendment 2026-11-03 — git workflow adopted

Initial adoption of the git workflow topic rule. Key decisions recorded:

- All agent work lands on main; `coda/<slug>` refs are traceability only.
- Hunk-scope commits (explicit paths) because the tree is shared with other
  sessions and the operator; `git add -A` is forbidden.
- The full test suite is a mandatory push gate; pre-existing failures are
  fixed, not excused.
- Worktrees under `.wt/` are scratch: merge or discard before the turn ends,
  never push.
