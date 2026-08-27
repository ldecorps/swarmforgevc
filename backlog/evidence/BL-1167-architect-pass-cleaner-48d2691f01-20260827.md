# BL-1167 — architect pass — 20260827 (cleaner rematch)

**Received:** `merge_and_process cleaner 48d2691f01` (handoff
`00_20260827T143305Z_000028_from_cleaner_to_architect`)
**Merged at:** cherry-picked `48d2691f01` → `ccc63d8cf`
**Task:** BL-1167-same-model-coder-seats-bypass-tier-routing

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Parcel intent

When every seat of a stage shares the same effective `--model`, BL-1001 tier
filtering is bypassed and BL-983 idle-first routing applies. Tier discipline
returns when models differ.

## Merge note

Cherry-picked `48d2691f01`. Resolved `index.js` conflict — kept HEAD registry
(bl1167 already registered; cleaner tip dropped unrelated handlers). Dropped
duplicate BL-1167 test block in `seat_difficulty_lib_test_runner.bb` that
referenced removed symbols (`parse-window-seats`, `stage-models-uniform?`).

## Checks

| Check | Result |
|-------|--------|
| Unit | **ALL PASS** (`seat_difficulty_lib_test_runner.bb`) |
| APS | **3/3** (`BL-1167-same-model-coder-seats-bypass-tier-routing.feature`) |
| Wiring | `bl1167SameModelSeatRoutingSteps` registered; `seat_difficulty_lib.bb` same-model bypass via `stage-models-equivalent?` |

## Forward

`git_handoff` → **hardender**, task `BL-1167-same-model-coder-seats-bypass-tier-routing`.

By architect.
