# BL-653 — architect pass — 20260826

- merge_and_process cleaner tip `6f3a2bc874` (doc conflicts in BL-723/BL-727
  how-tos — kept BL-728 closed status).
- Tree preserved: **8834** tracked paths (additive merge).

## Architecture / boundaries

- Babashka operator layer only — no extension production surface, no webview/tmux
  bypass from TypeScript. Pure policy in `operator_lib.bb` (`tick-observed-events`,
  `manufactured-tick-event-types`, `babysitter-escalation-event`); IO in
  `operator_runtime.bb`, `babysitter_check.bb`, `operator_enqueue_event.bb`.
- Patrol/liveness pseudo-events (`SWARM_CHECK_TIMER`, `dead-agent-events`) retired
  from the operator tick path; deterministic babysitter owns escalation emission
  (`babysitter_check.bb` → `operator_enqueue_event.bb`).
- Co-change: expected operator/babysitter cluster coupling; no forbidden
  extension-layer edges (no TS production in parcel).

## Prior specifier bounce — resolved

- Acceptance feature + `acceptance:` pointer present; APS handler registered.

## Invariants

1. **Operator wakes only on human message or deterministic escalation** —
   `operator_lib_bl653_property_runner.bb` (forbidden types never from
   `tick-observed-events`) + `operator_lib_test_runner.bb` BL-653 section +
   `test_operator_runtime_bl653_escalation_driven.sh`.
2. **Patrol wake not removed before escalation producer** — `babysitter_check.bb`
   wires CRIT findings to `BABYSITTER_ESCALATION` before tick retires
   `SWARM_CHECK_TIMER`/`dead-agent-events`; shell lane proves end-to-end enqueue
   and launch.

## Required wiring

- APS `bl653OperatorEscalationDrivenSteps` registered in `index.js`.

## Property-testing pass

- `operator_lib_bl653_property_runner.bb`: ALL PASSED (non-vacuous — fails if
  forbidden types re-enter tick path).

## Verification

- `operator_lib_test_runner.bb`: ALL TESTS PASSED
- `test_operator_runtime_bl653_escalation_driven.sh`: ALL CHECKS PASSED

Pass → hardender.

By architect.
