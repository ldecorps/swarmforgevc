# BL-748 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `0b2a34d292` (`log-routing-skip!` catches I/O failures,
reports on stderr, returns a sentinel) into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 0b2a34d292 HEAD`.

## Checks run

1. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-748-routing-skip-recording-failure-never-withholds-delivery.feature`:
   4/4 pass.

## Cleanup performed

- `swarm_handoff.bb`: extracted `report-nonfatal!` so `log-routing-skip!` and
  `try-sync-deliver!` share one stderr + `:failed` posture.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-748-bl623-log-routing-skip-uncaught-exception-blocks-delivery`.

By cleaner.
