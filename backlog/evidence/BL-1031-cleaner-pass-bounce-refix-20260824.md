# BL-1031 cleaner pass (QA bounce re-fix) — 2026-08-24

## Inbound

Merged coder commit `76915b256a` (fifo-handshake on depth≥2 pipe-hold
fixtures so WSL no longer races `sleep & exit` into silent exit 0) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 76915b256a HEAD`.

Prior QA bounce (`BL-1031-qa-bounce-20260824.md`): D1–D3 blamed **coder**
(intermittent undrainable / hang fixtures returning exit 0 instead of 124).
No cleaner-blamed items. Prior cleaner helper `wait-bound-hit-result?` in
`pre_qa_gate_gather_lib.bb` remains in lineage.

## Bounce clearance

| Check | Result |
|---|---|
| Unit (`daemon_cycle_guard_lib_test_runner.bb`) | ALL PASS |
| Unit stress ×10 (undrainable / D1 class) | **0/10** fails |
| Properties (`daemon_cycle_guard_lib_property_runner.bb`) | ALL PROPERTIES HOLD |
| Acceptance (BL-1031 feature) | **7/7** |
| D1 / D2 / D3 class (silent exit 0 on pipe-hold) | cleared under repeat |

## Cleanup review

NONE. Fifo sync lives only in the two fixture runners (unit + property);
not production DRY debt. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree`.

By cleaner.
