# Design intent — what the system SHOULD do

Created: 2026-11-03. This is the first document of the required-reading
triad. The behaviour reference records what the code ACTUALLY does; when the
two disagree, that is a bug and one converges to the other in the same
change.

## Purpose

`business-blueprints` is a curated library of business blueprints: structured
documents (patterns, playbooks, reference models) that describe how a
business capability works, plus the tooling that validates, indexes and
publishes them.

## What the system SHOULD do

1. **Hold a trustworthy corpus.** Every file in `blueprints/` is a valid
   blueprint document conforming to `schema/blueprints.schema.json`. The
   corpus is the source of truth; tools read it and never rewrite it.
2. **Validate as a chokepoint.** `tools/validate.py` is the only judge of
   validity. A blueprint either passes (well-formed, schema-conformant,
   complete) or fails with a precise, actionable error. Nothing reaches the
   published index without passing validation.
3. **Publish a deterministic index.** `tools/index.py` derives
   `index/blueprints.json` from the corpus. Re-running it on an unchanged
   corpus produces an identical file. The index is derived state: it can be
   deleted and rebuilt at any time with no information loss.
4. **Expose a stable contract.** The schema and the index format are public
   contracts. Changes to them are additive (new optional fields, new entries)
   unless a plan explicitly versions them.
5. **Enforce its own policy.** The working organization (rules, roles, hooks,
   policy tests) is part of the system. The suite validates the policy the
   same way it validates blueprints: automatically, in CI, red first.

## Non-goals

- No runtime service, no multi-user editing, no external network calls in
  the core path.
- No machine-local settings: everything normative lives in the repo.

## Invariants (the Hard Rules, restated)

See AGENTS.md §3 and `docs/HARD_RULES_HISTORY.md`. In short: no silent corpus
loss; one writer per fact; validation is a chokepoint; idempotent additive
index writes; strict critical reads.
