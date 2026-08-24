# BL-1101 cleaner pass (architect bounce re-fix) — 2026-08-24

## Inbound

Merged architect bounce `fda7627c34` (D1: empty-array expand under
`set -u` / bash 3.2 after cleaner `emit_labeled_list` DRY) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor fda7627c34 HEAD`.

Prior bounce blamed **cleaner** (not coder): length-guard before
`"${arr[@]}"` was removed when always passing both arrays into the helper.

## Bounce clearance

| Check | Result |
|---|---|
| Length-guard before `"${SURVIVORS[@]}"` / `"${SKIPPED[@]}"` | restored |
| `emit_labeled_list` kept for shared print shape | yes |
| Happy path (`ALL MUTANTS KILLED`) under `set -u` | ok (host bash 5.2) |
| Acceptance BL-1101 | **6/6** |
| Background asserts length-guard + emit_labeled_list | ok |

## Cleanup review

NONE beyond D1 fix. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1101-hand-authored-sweep-reports-success-with-skipped-mutants`.

By cleaner.
