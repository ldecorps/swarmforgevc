# BL-754 cleaner pass — tip-pure re-handoff — 2026-08-27

## Inbound

Handoff `825ac80ab3` (evidence-only after QA entangled-tip bounce). Initial
`git merge --no-ff` pulled BL-597/BL-780/BL-781 hitchhikers from coder branch
history — **reverted** via cherry-pick reset + `-s ours` merge to record ancestry
without polluting the tree.

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/required_stages_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-754-stage-skip-reasons-never-silently-loses-a-stage.feature`:
   5/5 pass.
3. **Ancestry:** `git merge-base --is-ancestor 825ac80ab3 HEAD`.

## Cleanup performed

Stripped hitchhiker merge (BL-597 promotion, BL-780/781 spec churn, intake) —
this parcel carries evidence only; `required_stages_lib.bb` unchanged vs prior
pass.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-754-bl661-unquoted-flow-reason-silently-mis-parses-and-drops-stages`,
commit **`825ac80ab3`** (tip-pure — evidence only, no branch pollution).

By cleaner.
