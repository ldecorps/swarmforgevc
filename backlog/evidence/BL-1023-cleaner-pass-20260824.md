# BL-1023 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `3bcf29b221` (adopt-or-refuse run ticket at
initiation; `move-ticket!` returns `{:ok? …}` instead of silent nil) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 3bcf29b221 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/expedite_lib_test_runner.bb`:
   ALL PASS.
2. **Babashka properties** —
   `bb swarmforge/scripts/test/bl1023_bookkeep_property_runner.bb`:
   ALL PROPERTIES HOLD (500 runs).
3. **Shell fixture** —
   `bash swarmforge/scripts/test/test_bl1023_expedite_bookkeep.sh`:
   ALL BL-1023 FIXTURE CHECKS PASSED.
4. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1023-expeditor-refuses-a-run-ticket-it-cannot-bookkeep.feature`:
   6/6 pass.

## Cleanup performed

- `expedite_lib.bb`: named refuse/adopt helpers + `adoptable-run-folders` so
  `bookkeep-plan` stays a thin cond.
- `expedite_cli.bb`: extracted `must-move-ticket!` and `apply-bookkeep-plan!`
  so adopt/park/done moves share one loud-failure path.

## Findings beyond that

NONE for BL-1023. Inventory NONE.
Note: `test_expedite_cli.sh` still has a pre-existing failure on scenario 15
(`stage-timeout` string); BL-1023 assertions in that suite pass; out of scope.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1023-expeditor-done-bookkeeping-silently-no-ops-when-its-ticket-is-not-active`.

By cleaner.
