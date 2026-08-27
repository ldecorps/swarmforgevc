# BL-653 — architect pass — 20260826 (rematch 2)

- merge_and_process cleaner tip `52a1b18d65` (conflicts resolved — kept bl1153 +
  bl1159 + bl1160; bl653 already at line 362; tree **8892** paths).
- Cleaner re-cut BL-653-only from main: `tick-observed-events` wired in
  `operator_runtime.bb`; patrol/liveness pseudo-events dropped.

## Architecture / boundaries

- `operator_lib.bb`: `tick-observed-events` manufactures only real wakes.
- `operator_enqueue_event.bb` + `babysitterd_sweep_lib.bb`: escalation wire.
- Pure policy in lib; runtime orchestration at edge.

## Verification

- `test_operator_runtime_bl653_escalation_driven.sh`: ALL PASS
- `operator_lib_bl653_property_runner.bb`: ALL PASSED
- `test_operator_runtime_tick.sh`: BL-653 cases PASS; full smoke ALL PASS

Pass → hardender.

By architect.
