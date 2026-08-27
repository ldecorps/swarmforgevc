# BL-1167 — hardener pass (cleaner rematch) — 20260827

## Inbound

Architect `21d13daf72` after cleaner `48d2691f01` — refactored
`stage-models-equivalent?` API (replaces `stage-models-uniform?`).

## Merge

Merged `21d13daf72` with `--no-ff` (clean).

## Hardening

| Gate | Result |
|---|---|
| Unit | **ALL PASS** (`seat_difficulty_lib_test_runner.bb`) |
| Properties | **2/2** (`bl1167SameModelSeatRouting.property.test.js` — rematched API) |
| Acceptance | **3/3** (`BL-1167-same-model-coder-seats-bypass-tier-routing.feature`) |
| Gherkin soft | **inapplicable** (plain Scenarios; exit 2) |
| Cooldown | **skip-cooldown** (`seat_difficulty_lib.bb`, `ready_for_next_task.bb`) |
| Surgical sweep (5) | **killed=5 survived=0 skipped=0** (anchors refreshed for `stage-models-equivalent?`) |

## Rematch fixes

- Property test updated from removed `parse-window-seats` / `stage-models-uniform?` to `stage-models-equivalent?` + `:conf-text`.
- `bl1167_same_model_seat_mutation_sweep.sh` anchors refreshed (prior sweep skipped=5 stale).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1167-same-model-coder-seats-bypass-tier-routing`.

By hardender.
