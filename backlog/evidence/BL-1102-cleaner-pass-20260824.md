# BL-1102 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `31dce875c1` (bounded `sh!` returns spawn failures
instead of throwing) into `swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor 31dce875c1 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1102-bounded-sh-throws-on-spawn-failure.feature`:
   6/6 pass.

Property suite not run (cleaner does not own property tests). CRAP/mutation/DRY
tooling not wired for `.bb` — degraded gate is the unit suite.

## Cleanup performed

- Split `sh!` into `spawn-failure-result` (BL-1102) and
  `await-bounded-process` (BL-1021 drain/timeout) so each helper stays
  under CC 6; `sh!` itself is only split-args → try-spawn → branch.

## Findings beyond that

NONE. Exit 127 + `:spawn-failed?` stays distinguishable from exit 124 and
from a real child non-zero; drain throws still propagate.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1102-bounded-sh-throws-on-spawn-failure`.

By cleaner.
