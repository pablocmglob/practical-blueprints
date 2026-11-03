# T1 — Set up the multi-agent working organization

State: Done
Owner: planning session (CODA)
Created: 2026-11-03

## Brief

Set up the way of working for this repository: one body of rules
(AGENTS.md + `.agents/rules/` + CODA.md), role charters with a generator,
hooks and policy tests that enforce the policy, the `.tasks/` tracker as the
only queue, and the docs triad. All work lands on main.

## Spec change

This task IS the bootstrap; the spec is the deliverable list in the
operator's request. No separate `.specs/` folder for T1.

## Acceptance

- AGENTS.md core + topic rules + CODA.md exist and import correctly
- `.agents/roles/*.md` + `tools/gen_agents.py` + generated `.coda/agents/` in sync
- `.coda/settings.json` hooks + hook scripts present
- `.tasks/` structure with README and this task file
- docs triad + SSOT registry + Hard Rules history + flags registry + tests README
- policy tests pass (red first where behavioural)
- full gate green, commit subject ends with (T1), pushed to main
