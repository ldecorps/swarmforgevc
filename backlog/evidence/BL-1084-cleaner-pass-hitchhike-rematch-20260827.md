# BL-1084 cleaner pass — hitchhike rematch — 2026-08-27

## Inbound

Merged coder commit `b8dc7b49f6` (hitchhike-bounce rematch after architect
revert; supersede guard re-verified on tip) into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry: `git merge-base --is-ancestor b8dc7b49f6 HEAD`.

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

NONE.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1084-a-superseded-task-stops-at-every-stage-hitchhike-bounce`.

By cleaner.
