# BL-1167 — cleaner pass — 20260827

## Inbound

Coder tip `d1369d1c61` already tip-pure on current `origin/main` (parent
`225b07964`). Cleanup commit `fa828f195` on that lineage.

## Checks run

1. **Tip purity** — Stripped BL-1185 hitchhiker (`supersede_lib` load +
   `task-name-for-difficulty`) from `ready_for_next_task.bb`; BL-1167-only
   models/`window-seats` wiring remains. `dels` only in hitchhiker strip.
2. **Unit** — `seat_difficulty_lib_test_runner.bb`: ALL PASS.
3. **Property** — `bl1167SameModelSeatRouting.property.test.js`: 2/2 PASS.
4. **Structure** — `window-flag-map` shared by tier/model parsers; blank line
   before `parse-mutation-cost`.

## Cleanup performed

- Dropped BL-1185 Work-note mutation_cost attribution from this tip (not on
  `origin/main` tip of `ready_for_next_task.bb`; out of BL-1167 scope).
- Formatting: blank line after `stage-models-uniform?`.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1167-same-model-coder-seats-bypass-tier-routing`.

By cleaner.
