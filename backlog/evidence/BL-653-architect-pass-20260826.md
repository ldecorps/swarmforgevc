# BL-653 — architect pass — 20260826

- merge_and_process cleaner tip `9a59715fac` (conflicts in bl653 steps + index.js
  — took cleaner steps; kept bl653 at sorted registration only, no duplicate).

## Architecture / boundaries

- Escalation-driven wake model in Babashka operator layer (`operator_runtime.bb`,
  `operator_lib.bb`, `operator_enqueue_event.bb`) — no extension-host/webview
  surface; tmux remains substrate for agent processes, not bypassed from TS.
- `tick-observed-events` manufactures only real sources (human command,
  coordinator inbox, escalation enqueue) — forbidden types
  `SWARM_CHECK_TIMER`/`AGENT_EXITED`/`AGENT_STALLED` excluded per BL-653.
- APS handler registered in `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- Invariant 1: `operator_lib_bl653_property_runner.bb` — property over all
  reachable/command/inbox combinations; forbids patrol/liveness pseudo-events.
- Invariant 2 (patrol not removed before producer): `test_operator_runtime_bl653_escalation_driven.sh`
  scenarios 03/06 prove BABYSITTER_ESCALATION and SWARM_CONTROL_LOST reach inflight;
  scenario 08 confirms night-start pid-hold tourniquet removed only after wiring live.

## Verification

- `test_operator_runtime_bl653_escalation_driven.sh`: ALL CHECKS PASSED
- `operator_lib_bl653_property_runner.bb`: ALL PASSED
- Dependency gate: N/A (no `extension/src` in parcel)

Inventory: NONE

Pass → hardender.

By architect.
