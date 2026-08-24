# BL-1001 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `a1eb4867ce` (`seat_difficulty_lib.bb` + claim-path
filter in `ready_for_next_task.bb`; `full-forge` coder window declares
`--seat-tier hard`) into `swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor a1eb4867ce HEAD`.

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb`:
   ALL PASS.
2. **Properties** —
   `npx vitest run --config extension/vitest.properties.config.mjs test/bl1001DifficultyAwareSeatRouting.property.test.js`:
   3/3 pass.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1001-difficulty-aware-coder-seat-routing.feature`:
   6/6 pass. Required wiring: steps registered in `index.js`.

## Cleanup performed

- `seat_difficulty_lib.bb`: extracted `tier-ceil` /
  `idle-better-fit-sibling?` so `difficulty-claim-decision` stays a thin
  cond.
- `ready_for_next_task.bb`: one `pack-conf` binding shared by the affinity
  deadline parse and seat-tier parse.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1001-difficulty-aware-coder-seat-routing`.

By cleaner.
