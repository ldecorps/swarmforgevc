# BL-1110 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `15e4c5da77` (trust in-flight sweep-marker before
stale-heartbeat restart; keep handoffd threshold 120) into
`swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor 15e4c5da77 HEAD`.

## Checks run

1. **Shell unit** — `bash swarmforge/scripts/test/test_daemon_log_freshness.sh`:
   all BL-1110 checks PASS. Suite still ends FAILURES on pre-existing
   BL-796 nvm-PATH cases (not this parcel).
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1110-handoffd-heartbeat-stale-past-budget-recurrence.feature`:
   3/3 pass (budget 120 unchanged; suppress path; pid-claim cool-off).

Property suite not run (cleaner does not own property tests). CRAP/mutation/DRY
tooling not wired for shell — degraded gate is the shell suite above.

## Cleanup performed

- Tightened `in_flight_sweep_under_budget`: single idle `case`, early
  returns via `[ ] || return 1`, and one age predicate
  (`age_ms >= 0 && age_ms <= budget`) instead of nested if/return chains.
  Behavior unchanged.

## Findings beyond that

NONE. Threshold stays 120; suppress is named `suppress-in-sweep`; over-budget
marker still restarts.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1110-handoffd-heartbeat-stale-past-budget-recurrence`.

By cleaner.
