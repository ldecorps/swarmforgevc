# BL-754 cleaner pass — 2026-08-27 (re-entry)

## Inbound

Merged coder commit `fccf03f5b5` (re-entry verification after cleaner bounce)
into `swarmforge-cleaner` via `git merge --no-ff`. Stripped merge hitchhikers
(BL-589 done yaml/topic deletion, BL-980 step registration) — not part of this
parcel. Ancestry: `git merge-base --is-ancestor fccf03f5b5 HEAD`.

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/required_stages_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-754-stage-skip-reasons-never-silently-loses-a-stage.feature`:
   5/5 pass.

## Cleanup performed

NONE. `required_stages_lib.bb` structure from prior pass remains within bounds.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-754-bl661-unquoted-flow-reason-silently-mis-parses-and-drops-stages`.

By cleaner.
