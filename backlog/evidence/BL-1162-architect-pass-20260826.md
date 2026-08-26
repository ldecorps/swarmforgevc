# BL-1162 — architect pass — 20260826

- merge_and_process cleaner tip `1b685067e2` (conflicts resolved in
  `specs/pipeline/steps/index.js`, `Specification.MD`, BL-1159 yaml — kept
  bl1160 + bl1162 handler registrations; tree merge commit `72c9d1e4b`).

## Architecture / boundaries

- Single root-scoped cron registry in `swarmforge_cron_lib.sh`; install/uninstall
  thin wrappers (`install_swarmforge_crons.sh`, `uninstall_swarmforge_crons.sh`)
  delegate to freshness + schedule helpers — satisfies symmetric lifecycle spec.
- Pure schedule rendering in `legacy_operator_schedule_lib.bb` and
  `reconcile_shift_schedule_crontab.bb`; shell scripts own crontab I/O only.
- `stop-swarm.sh` calls `uninstall_swarmforge_crons.sh` after successful teardown;
  `start_ancillary_services.sh` calls `install_swarmforge_crons.sh` — no tmux bypass,
  no extension-host/webview surface.
- APS handler `bl1162StartStopSwarmCronLifecycleSymmetrySteps` registered in
  `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- Stop invariant: `bl1162_swarmforge_cron_property_runner.sh` encodes
  `swarmforge_cron_line_belongs_to_root` / `filter_out_root` (non-vacuous:
  sibling + human lines preserved, root A lines dropped); lifecycle scenario 01/03/04
  integration-asserts full removal.
- Start invariant: lifecycle scenario 02 asserts freshness + schedule start/stop
  lines after `start_ancillary_services.sh` — appropriate Babashka-boundary encoding.
- No additional undeclared property coverage warranted on touched pure modules
  beyond the existing property runner.

## Verification

- `test_bl1162_start_stop_swarm_cron_lifecycle.sh`: ALL CHECKS PASSED
- `bl1162_swarmforge_cron_property_runner.sh`: ALL CHECKS PASSED
- Dependency gate: N/A (no `extension/src` files in parcel)
- Bounce history on main: none for BL-1162

Inventory: NONE

Pass → hardender.

By architect.
