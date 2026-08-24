# BL-1019 cleaner pass (QA bounce hitchhiker clear) — 2026-08-24

## Inbound

Merged coder commit `fc20dbfe06` (clear hitchhiking BL-1101 empty-array
expand under `set -u` on the BL-1019 tip) into `swarmforge-cleaner` via
`git merge --no-ff`. Conflicted with our prior bounce-refix of the same
contract; resolved to length-guard before `"${arr[@]}"` plus
`emit_labeled_list` (both sides agreed on the guard). Ancestry:
`git merge-base --is-ancestor fc20dbfe06 HEAD`.

Prior QA bounce (`BL-1019-qa-bounce-20260824.md`): D1 hitchhiker blamed
**coder** (unfinished BL-1101 bash 3.2 expand on the land tip).

## Bounce clearance

| Check | Result |
|---|---|
| Length-guard before SURVIVORS/SKIPPED expand | present |
| `emit_labeled_list` retained | yes |
| BL-1101 acceptance | **6/6** |
| BL-1019 acceptance | **5/5** |
| `swarm_status_lib_test_runner.bb` | ok |

## Cleanup review

Merge conflict resolution only (same D1 fix both lineages). Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1019-swarm-status-agrees-with-has-session`.

By cleaner.
