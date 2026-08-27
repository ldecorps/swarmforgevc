# BL-754 cleaner pass — rematch — 2026-08-27

## Inbound

Merged coder commit `2c26e8f9eb` (re-entry rematch: invariant encoding in
`required_stages_test_runner.bb` + updated coder evidence) into
`swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor 2c26e8f9eb HEAD`.

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/required_stages_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-754-stage-skip-reasons-never-silently-loses-a-stage.feature`:
   5/5 pass.

## Cleanup performed

NONE. New invariant-encoding assertions are cohesive; no structural refactor
needed.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-754-bl661-unquoted-flow-reason-silently-mis-parses-and-drops-stages`.

By cleaner.
