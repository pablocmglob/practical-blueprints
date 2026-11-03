# Hard Rules — history and current form

Each Hard Rule: its current form, the regression tests that lock it, and the
history. Any edit that weakens one is blocked unless it strengthens the
bound. A change that merely READS a flag where no decision is made is fine
and should say so in the PR/commit.

## HR-1 — No silent corpus loss

- **Current form:** every blueprint file present before a tool run is present
  after it, unless the run's plan explicitly says to remove it.
- **Locked by:** `tests/policy/test_corpus_integrity.py` (L1).
- **History:** 2026-11-03, initial adoption. An early draft of the index tool
  rewrote the corpus directory in place; the rule and its test were written
  the same day to make that class of loss a deployment blocker.

## HR-2 — Single writer per fact

- **Current form:** each fact in the SSOT registry has exactly one canonical
  location that writes it.
- **Locked by:** `tests/policy/test_ssot_pins.py` (L1/L2).
- **History:** 2026-11-03, initial adoption. Written after reviewing how
  parallel representations drift (schema restated in validators, queue
  duplicated in chat).

## HR-3 — Validation is a chokepoint

- **Current form:** nothing enters the published index without passing
  `tools/validate.py`; no parallel validator may exist.
- **Locked by:** `tests/policy/test_ssot_pins.py` (L1/L2).
- **History:** 2026-11-03, initial adoption.

## HR-4 — Idempotent, additive index writes

- **Current form:** re-running `tools/index.py` on the same corpus yields the
  same index (no duplicates, no loss); index writes never delete entries not
  covered by the current corpus.
- **Locked by:** `tests/policy/test_index_idempotent.py` (L1).
- **History:** 2026-11-03, initial adoption.

## HR-5 — Strict critical reads

- **Current form:** a failed read of a critical fact raises and writes
  nothing; it never falls back to a default silently.
- **Locked by:** `tests/policy/test_strict_reads.py` (L1).
- **History:** 2026-11-03, initial adoption.

## Amendment procedure

An amendment either strengthens a bound or it is refused. Record it here with
a date, the diff that changed the bound, and the new/updated regression test.
