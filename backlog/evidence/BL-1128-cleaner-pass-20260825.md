# BL-1128 cleaner pass — 2026-08-25

## Inbound

Coder tip `1201eb260c` — hitchhike CLEAN vs `origin/main`. Reset cleaner
branch to `origin/main` (left prior BL-1126 tip at `f2394e59b6` in objects)
and cherry-picked → tip `29ad33fe7` (BL-1128-only).

## Checks run

1. `headroom_cap_raise_lib_test_runner.bb` — ALL CHECKS PASSED
2. `promotion_gates_lib_test_runner.bb` — ALL PASS

## Cleanup performed

- DRY: `promotion_gates_lib` loads `headroom_cap_raise_lib` and reuses
  `depth-cap-throttle-ticket?` (dropped duplicate regex helper).
- Extract `apply-raise!` from `run-raise!` for a thinner raise path.

## Forward

`git_handoff` to `architect`, priority `50`, task
`BL-1128-raise-active-cap-on-host-headroom`.

By cleaner.
