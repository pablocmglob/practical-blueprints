# Behaviour reference — what every entry point ACTUALLY does today

Created: 2026-11-03. Format per entry: **Inputs / Returns / Side effects /
Edge cases**. If an entry and the code disagree, that is a bug: one converges
to the other in the same change, never silently.

> This reference starts small because the codebase starts small. Every new
> method or tool entry point adds its entry here in the same change.

---

## `tools/gen_agents.py`

**Inputs:** `--write` (render generated files) or `--check` (verify rendered
files match; exit 1 on drift). Scans `.agents/roles/*.md` and
`.coda/agents/`.

**Returns:** exit 0 on success; exit 1 with a list of drifted/missing files
on `--check`.

**Side effects:** with `--write`, creates/overwrites `.coda/agents/<name>.md`
for each role file. Never touches role files.

**Edge cases:** a role file without `name:` frontmatter is an error (exit 2);
a generated file with no matching role is reported as orphaned on `--check`.

## `tools/validate.py`

**Inputs:** `--corpus <dir>` (default `blueprints/`), `--schema <file>`
(default `schema/blueprints.schema.json`), optional `--report <file>`.

**Returns:** exit 0 if all pass; exit 1 with one error line per failure.

**Side effects:** none on the corpus (read-only by design — HR-1).

**Edge cases:** missing schema file → raise, write nothing (HR-5); a file
that is not valid JSON → precise error naming the file and the problem.

## `tools/index.py`

**Inputs:** `--corpus <dir>` (default `blueprints/`), `--out <file>` (default
`index/blueprints.json`).

**Returns:** exit 0; prints a one-line summary (n blueprints indexed).

**Side effects:** writes the index file. Idempotent: same corpus → same
bytes. Additive: never deletes entries not covered by the current corpus
(HR-4).

**Edge cases:** empty corpus → writes an empty index (valid state); duplicate
ids in the corpus → error, writes nothing (HR-5).

## `tools/run_tests.py`

**Inputs:** optional path filter; default runs the whole suite.

**Returns:** exit 0 if all pass; exit 1 with the failing test names.

**Side effects:** none beyond the tests themselves; policy tests read repo
files only.

**Edge cases:** a missing required file (e.g. AGENTS.md) fails the relevant
policy test with a clear message, not a crash.
