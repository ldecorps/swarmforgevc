# BL-1167 — cleaner pass (tip-pure rematch) — 20260827

## Inbound

Coder tip `91ebfe715d` tip-pure on `origin/main`. Note: checkout named paths
only; **no** `-s ours`. Follows BL-1185 materialize on same cleaner branch.

## Checks run

1. **Tip purity** — BL-1167 paths materialized; shared docs/index/steps merged
   surgically (BL-602/738/1185 entries preserved).
2. **Unit** — `seat_difficulty_lib_test_runner.bb`: ALL PASS.
3. **Property** — `bl1167SameModelSeatRouting.property.test.js`: 2/2 PASS.
4. **Regression** — `bl1185WorkNoteMissingTaskHeader.property.test.js`: 3/3 PASS.

## Cleanup performed

- Merged BL-1167 `models`/`window-seats` wiring into `ready_for_next_task.bb`
  without dropping BL-1185 `task-name-for-difficulty` / `supersede_lib`.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1167-same-model-coder-seats-bypass-tier-routing`.

By cleaner.
