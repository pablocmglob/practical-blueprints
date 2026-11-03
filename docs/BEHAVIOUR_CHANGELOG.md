# Behaviour changelog — dated audit trail

Append-only. One entry per behaviour change: date, what changed, which tests
state it, and any deviation from the plan.

## 2026-11-03

- **T1 — Initial setup of the multi-agent working organization.** Created the
  rules body (AGENTS.md + `.agents/rules/*.md` + CODA.md), role charters and
  generator (`tools/gen_agents.py`), hooks (`.coda/settings.json` +
  `.coda/hooks/`), the `.tasks/` tracker, the docs triad and registries, and
  the policy test suite. No blueprint corpus yet; validators are stubs whose
  behaviour is documented in `docs/BEHAVIOUR_REFERENCE.md`.
- Tests added: policy tests (see `tests/policy/`). Red-first records are in
  each implementer report; the drift test and the frozen-archive test were
  verified red before their subjects existed.
