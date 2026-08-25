# BL-754 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `8a8e86d391` (malformed unquoted `stage_skip_reasons`
surfaced via `:malformed`; quote-style parity; never silent stage drop) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 8a8e86d391 HEAD`.

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/required_stages_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-754-stage-skip-reasons-never-silently-loses-a-stage.feature`:
   5/5 pass.

## Cleanup performed

- `required_stages_lib.bb`: extracted `take-flow-reason-quoted` (shared
  double/single quote path) and `flow-ok` / `flow-malformed` so
  `parse-flow-skip-reasons` stays a thin loop.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-754-bl661-unquoted-flow-reason-silently-mis-parses-and-drops-stages`.

By cleaner.
