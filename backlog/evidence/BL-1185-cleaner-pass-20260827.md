# BL-1185 — cleaner pass — 20260827

## Inbound

Coder tip `53710fdadd` was entangled vs `origin/main` (promotions, briefings,
BL-644/734/757, …). Tip-pure rebuild: `origin/main` + BL-1185 paths only
(ticket, topic, feature, steps, index wiring, `ready_for_next_task.bb`).

## Checks run

1. **Tip purity** — BL-1185 paths only; `dels=0`.
2. **Babashka** — `seat_difficulty_lib_test_runner.bb` ALL PASS;
   `supersede_lib_test_runner.bb` ALL PASS.
3. **Smoke** — `task-name-from-content` on Work-note body →
   `BL-1174-deprecate-operator-verbs-scan-docs`.

## Cleanup performed

NONE. `task-name-for-difficulty` is a thin reuse of supersede_lib; CC stays
low. Other `header-field "task"` call sites (branch-claim / rework affinity)
are out of ticket scope.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1185-work-note-missing-task-header-defers-hard-seat`.

By cleaner.
