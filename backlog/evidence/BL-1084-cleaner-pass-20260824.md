# BL-1084 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `a8a794e409` (durable `.swarmforge/superseded/` store +
pre-dispatch guard in `ready_for_next.bb` so every stage refuses a
superseded task) into `swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor a8a794e409 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/supersede_lib_test_runner.bb`:
   ALL PASS.
2. **Babashka properties** —
   `bb swarmforge/scripts/test/bl1084_supersede_property_runner.bb`:
   ALL PROPERTIES HOLD (500 runs).
3. **Shell fixture** — `bash swarmforge/scripts/test/test_supersede_guard.sh`:
   ALL PASS.
4. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1084-a-superseded-task-stops-at-every-stage.feature`:
   9/9 pass.

## Cleanup performed

- `supersede_lib.bb`: extracted `refuse-unreadable` / `refuse-superseded` so
  `turn-verdict` stays a thin case over named refusal shapes.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1084-a-superseded-task-stops-at-every-stage`.

By cleaner.
