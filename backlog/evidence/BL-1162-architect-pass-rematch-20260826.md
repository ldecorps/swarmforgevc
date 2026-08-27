# BL-1162 — architect pass rematch — 20260826

- merge_and_process cleaner recut `472f1fae1c` (QA bounce D1: tip entangled with
  BL-653/660/588/1160; conflicts resolved in yaml, index.js, reconcile bb,
  property runner — kept bl1152 handler registration; took legacy-only reconcile).
- Reviewed commit `472f1fae1c` purity vs `origin/main`: 24 BL-1162-only paths;
  `rg '653|660|588|1160|1152'` on land diff — empty.

## Architecture / boundaries

- Single registry in `swarmforge_cron_lib.sh`; symmetric install/remove wrappers
  unchanged from first pass.
- Reconcile now legacy-only (`continuous-shifts.json`) — BL-660 `swarm_shift_lib`
  hitchhiker dropped per recut (specifier: coordinate BL-660, do not duplicate).
- Shell owns crontab I/O; pure bb renders schedule lines — boundary intact.
- APS handler registered in `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- Stop/start invariants encoded in expanded property runner (13 checks) +
  lifecycle shell tests — all green.
- Hardener mutation sweep preserved: 7/7 killed.

## Verification

- `test_bl1162_start_stop_swarm_cron_lifecycle.sh`: ALL CHECKS PASSED
- `bl1162_swarmforge_cron_property_runner.sh`: ALL CHECKS PASSED
- `bl1162_swarmforge_cron_mutation_sweep.sh`: 7/7 killed
- Dependency gate: N/A (no `extension/src` in parcel)
- QA bounce D1 remediation confirmed on recut tip

Inventory: NONE

Pass → hardender.

By architect.
