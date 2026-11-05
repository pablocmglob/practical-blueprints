# AGENTS.md — always-on core

This is the SHORT, harness-neutral core of the working organization for this
repository. Topic rules live in `.agents/rules/` and are imported below; this
file restates in one line anything that can lose data, cause regressions, or
touch critical paths, because some harnesses only load a topic when the task
matches. History behind every rule lives in `docs/` — each section names its
history doc.

**Imports (read all of these):**

- @./.agents/rules/git-workflow.md
- @./.agents/rules/task-specs.md
- @./.agents/rules/ssot-registry.md
- @./.agents/rules/risk-routing.md
- @./.agents/rules/testing-and-docs.md

---

## 0. What this project is

`business-blueprints` is a curated library of business blueprints: structured,
versioned documents (patterns, playbooks, reference models) plus the tooling
that validates, indexes and publishes them. There is no production service
yet; the load-bearing assets are the blueprint corpus, its schema, and the
validation tooling. Treat the corpus as the data layer and the validators as
the core logic.

## 1. Three standing rules (override anything older)

1. **Work the plan end to end without asking.** A session with a plan (a task
   file plus a spec change, or the operator's request) carries it through:
   code, tests, docs, gate, commit, push to main, task status move, spec
   publish. Pick the conventional option for small choices and record it
   (commit message, task file, changelog). Ask the operator only for: a Hard
   Rule that would weaken, destroying data, or a genuine product decision with
   no default. A conflict, a red test or a flaky dependency is something to
   fix, not a reason to stop. Never end a turn by declining to commit.
2. **Test-driven development is the method.** For every behaviour change:
   write the test that states it, run it and SEE IT FAIL for the right reason,
   then write the code, then refactor green. A bug fix starts with the
   reproducing test; a data-processing path gets an executing test (seed →
   call → read back → assert), never only a source-text assertion.
   Implementers report `Red first:` with the failing output; the reviewer
   re-checks it by reverting the fix and running the test. Only docs/comments
   skip it, saying so.
3. **Features ship ACTIVE.** A new switch defaults ON at its definition and at
   every call site. It ships OFF only when the plan says so, and then it needs
   an entry in `docs/flags_default_off.json` with `reason`, `activate_when`
   and `review`. A test fails on an OFF default without an entry, and on an
   entry for a switch that is no longer OFF. A switch that loosens a safety
   bound gets the safety audit (Hard Rules) before it ships.

## 2. Required workflow for any code change

**Guarded files** (touching one triggers the FULL protocol; other files use
steps 1, 4, 5, 6, 8):

- `blueprints/` — the corpus and its schema (core decision path)
- `tools/validate.py`, `tools/index.py` — validators / core logic
- `schema/blueprints.schema.json` — public contract
- `tests/smoke_backend.js` — integration smoke test
- `docs/BEHAVIOUR_REFERENCE.md`, `docs/BEHAVIOUR_CHANGELOG.md` — behaviour docs

1. PRE snapshot of what is documented and tested (`/review-consistency pre`
   or equivalent), so POST can report NEW / PERSISTS / CLOSED findings.
2. Read the behaviour-reference entry of every method you will touch.
3. Audit the change against `docs/DESIGN_INTENT.md`; block anything that
   could violate a Hard Rule under any edge case.
4. If it touches a fact in the SSOT registry, verify the canonical path is
   still the only writer/reader; never add a parallel representation.
5. Implement test-first. Tests are additive: no deletion, skip or weakening
   without an explicit changelog entry.
6. Update the behaviour reference.
7. Append to the changelog.
8. POST verification (`/review-consistency post`): audit docs, tests, API
   shape and code together; patch gaps; done only when CONSISTENT or only LOW
   remains.
9. Update the task tracker (`.tasks/`). The task is not done until the
   tracker matches reality.

## 3. Hard Rules (no change may weaken one)

Full text, regression tests and history: `docs/HARD_RULES_HISTORY.md`.
The safety auditor `hard-rule-auditor` checks EXACTLY these, one PASS / FAIL /
N/A per rule with file:line evidence, nothing else. It runs on every diff that
touches `blueprints/`, `tools/validate.py`, `tools/index.py`, or adds/changes
a default switch. Any edit that weakens one is blocked unless it strengthens
the bound; a change that merely READS a flag where no decision is made is fine
and should say so.

1. **No silent corpus loss.** Every blueprint file present before a tool run
   is present after it, unless the run's plan explicitly says to remove it.
   Locked by `tests/policy/test_corpus_integrity.js`.
2. **Single writer per fact.** Each fact in the SSOT registry has exactly one
   canonical location that writes it; a second writer is a bug. Locked by
   `tests/policy/test_ssot_pins.js`.
3. **Validation is a chokepoint.** Nothing enters the published index without
   passing `tools/validate.py`; no parallel validator may exist. Locked by
   `tests/policy/test_ssot_pins.js`.
4. **Idempotent, additive index writes.** Re-running `tools/index.py` on the
   same corpus yields the same index (no duplicates, no data loss); index
   writes never delete entries not covered by the current corpus. Locked by
   `tests/policy/test_index_idempotent.js`.
5. **Strict critical reads.** A failed read of a critical fact raises and
   writes nothing; it never falls back to a default silently. Locked by
   `tests/policy/test_strict_reads.js`.

## 4. Always-on essentials (restated from topic rules)

- All agent work lands on **main**. Never force-push main. Non-fast-forward →
  fetch, rebase, re-run the gate, retry. (git-workflow)
- A passing **full test suite is a mandatory push gate**. "Pre-existing" is
  not an excuse: fix it. (testing-and-docs)
- The `.tasks/` directory is **the only work queue**. No task file yet →
  create one before starting, no exception for small work. (task-specs)
- Functional commit subjects end with the task id: `(T12)` or `(T12+T13)`.
  Docs/chore/ci-only commits are exempt. (task-specs)
- Hunk-scope commits with explicit paths; **never `git add -A`** — the tree is
  shared with other sessions and the operator. (git-workflow)
- If the behaviour reference and the code disagree, that is a bug: one
  converges to the other in the same change, never silently. (testing-and-docs)
- Worktrees are local scratch: merge or discard each before the turn ends;
  never push them. (git-workflow)
- Everything lives in the repo; commit before you stop. (git-workflow)

## 5. Task tracker rules (short form; full rules in task-specs)

`.tasks/` is THE queue, internal to this repo, no external tools.

- First call of every session: read `.tasks/IN_FLIGHT.md` and scan the
  directory; claim a task file before working it (the brief is in its
  details).
- No task file yet? Create one before you start, no exception for small work.
- Allocate ids by FILE CREATION: probe → create `.tasks/task-<id>.md` →
  verify exactly one file with that name.
- Keep tasks true as state changes (To Do → In Progress → Done); before
  ending, every touched task sits in the right state.
- `.tasks/archive/` is a frozen, read-only archive; a test fails if a task is
  added there.
- A spec workflow (one folder per change: proposal, specs, design, tasks)
  wraps the PRE/POST protocol; publishing to the task tracker is a session
  step, never CI. A test goes red when specs changed without the tracker
  reflecting it.

## 6. Topic rules (imported above; edit there, never here)

| Topic | File | Read when |
| --- | --- | --- |
| Git workflow, worktrees, push gate | `.agents/rules/git-workflow.md` | committing, branching, pushing |
| Task tracker and spec workflow | `.agents/rules/task-specs.md` | starting/finishing any work |
| Single-source-of-truth registry | `.agents/rules/ssot-registry.md` | touching a fact, table, index or schema |
| Risk routing and roles | `.agents/rules/risk-routing.md` | deciding who does what, escalation |
| Testing layers and docs coupling | `.agents/rules/testing-and-docs.md` | writing tests or docs |

History docs (read when a rule's rationale matters): `docs/HARD_RULES_HISTORY.md`,
`docs/SSOT_REGISTRY.md`, `docs/BEHAVIOUR_CHANGELOG.md`, dated amendments in
`docs/amendments/`.
