# BL-653 — architect pass (rematch) — 20260826

- merge_and_process cleaner tip `ff22dd46a7` (index.js conflict — kept BL-660
  step registration alongside BL-653).
- Tree preserved: **8856** paths (additive).
- Restores operator escalation slice after BL-588 hitchhiker scrub deleted it.

## Architecture / boundaries

- Babashka operator layer unchanged from prior pass: `tick-observed-events`
  excludes patrol wakes; `babysitter_check.bb` → `operator_enqueue_event.bb`.
- Co-change: expected operator/babysitter cluster; no forbidden extension edges.

## Invariants

- Property runner + shell lanes green (same encoding as prior pass).

## Verification

- `operator_lib_test_runner.bb`: ALL TESTS PASSED
- `operator_lib_bl653_property_runner.bb`: ALL PASSED
- `test_operator_runtime_bl653_escalation_driven.sh`: ALL CHECKS PASSED
- BL-588 batch-recovery + BL-660 shift-pack artifacts still present on branch.

Pass → hardender.

By architect.
