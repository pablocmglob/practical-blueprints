# Topic rule: risk routing and roles

All agents run on the same base CODA model. The separation is strictly by
role, prompt context, and isolated worktrees. We route by the RISK and DOMAIN
of the diff, not its size. Role charters live in `.agents/roles/<name>.md`;
the generator `tools/gen_agents.py` renders `.coda/agents/<name>.md` from
them — never edit a generated file by hand.

## Roles (write-once charters in .agents/roles/)

| Role | Agent | Does | Never |
| --- | --- | --- | --- |
| Planner | the session | reads the required docs, decides, writes the spec change, assigns disjoint file sets, merges, runs the gate, commits, pushes, moves the tasks | spends its context on raw query output or file dumps |
| Fetcher | data-fetcher | read-only queries, log pulls, caller searches; returns RAW output plus the exact commands | interprets, writes anything |
| Backend implementer | plan-implementer | tasks of a WRITTEN plan one at a time in its own worktree: test red → code → docs; commits | redesigns, changes a shared contract, pushes, moves tasks |
| UI implementer | ux-implementer | the plan's screen tasks plus the read-only API shapes a screen needs; build + contract tests in its own worktree | writes core data, recomputes core decisions in the UI, pushes |
| Adversary | adversary | tries to BREAK every implementer diff: correctness, concurrency, swallowed failures, second writers, policy, security, test quality → BLOCK/PASS with concrete failing scenario | fixes code, praises, summarises the diff |
| Safety gate | hard-rule-auditor | PASS/FAIL per Hard Rule with file:line evidence | anything outside the five rules |
| Forensics (optional) | <domain>-investigator | one incident end to end, read-only, every claim cited | implements fixes |
| Chores | routine-runner | ONE fully specified job: run a named generator, run named tests and report, check a stated fact, make the one named doc edit | improvises, diagnoses, edits anything else, commits, pushes |

## Escalation is per call, strictly by risk

- Ambiguous request, design, root cause with conflicting evidence → **Planner**
  (never delegated downward).
- Core logic, a guarded file, the safety chain, main loops, permissions →
  **Adversary & Safety Gate** (adversary at high; hard-rule-auditor always
  runs, never skipped).
- A mechanical step with the exact command or edit written out →
  **routine-runner**.
- Raw data pulls, log reads, caller searches → **data-fetcher**.
- Implementers on defined, local work → medium effort by default; on a
  guarded file, the safety chain, or concurrency SQL → high effort.

Two rules that keep the cheap tiers safe: the cheap tier fetches and
executes, it does not judge (conclusions are the planner's, from raw output);
the medium and high tiers implement a written plan, neither designs (a wrong
plan comes back to the planner, never gets patched around). Small,
known-target work (a handful of tool calls) is done inline by the planner.

## The flow

1. Planner → parallel data-fetchers → planner decides.
2. Planner writes the plan: the spec change whose `tasks.md` IS the task
   list, split into DISJOINT file sets, one per implementer. No second queue.
3. Implementers run in parallel, each in its own worktree. They commit,
   report, and do not talk to each other. A needed change to a shared
   interface (signature, table, column, API shape, config key) goes back to
   the planner.
4. On each returned branch, in parallel: adversary and, when core logic, the
   data layer or a default switch changed, hard-rule-auditor. Any BLOCK/FAIL
   goes back to the implementer with the finding. A BLOCK stands until fixed;
   after two BLOCKs on one diff the planner re-plans; nobody merges over one.
   An implementer that fails the same task twice goes back to the planner,
   not to a bigger model. A re-review continues the SAME agent so only the
   delta is paid for.
5. Planner merges the worktree branches, runs the POST consistency check and
   the full test gate, commits, pushes to main, updates the task files.
   Worktrees are local scratch: merge or discard each before the turn ends;
   never push them.
6. Agent-teams / peer-to-peer features are not used: teammates agreeing
   contracts between themselves is exactly what step 3 forbids.
