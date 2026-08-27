# BL-1167 — cleaner pass — 20260827

## Inbound

Coder tip `d1369d1c61` (parent lagged after main moved). Tip-pure rebuild on
current `origin/main` (`d719a9664`): feat `0df196c12` → hitchhiker strip
`0452531b2` → this evidence.

## Checks run

1. **Tip purity** — BL-1167-only at tip; stripped BL-1185 hitchhiker
   (`supersede_lib` load + `task-name-for-difficulty`) from
   `ready_for_next_task.bb`. Models/`window-seats` wiring only.
2. **Unit** — `seat_difficulty_lib_test_runner.bb`: ALL PASS.
3. **Property** — `bl1167SameModelSeatRouting.property.test.js`: 2/2 PASS.
4. **Structure** — `window-flag-map` shared by tier/model parsers.

## Cleanup performed

- Dropped BL-1185 Work-note mutation_cost attribution (not on `origin/main`
  `ready_for_next_task.bb`; out of BL-1167 scope).
- Formatting: blank line after `stage-models-uniform?`.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1167-same-model-coder-seats-bypass-tier-routing`, commit tip below.

By cleaner.
