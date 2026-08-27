# BL-660 — architect pass — 20260826

- merge_and_process cleaner tip `ea1924f931` (conflicts resolved in BL-653/660
  yaml, done tickets, feature files, bl660 steps, index.js — kept bl660 once at
  sorted registration; preserved bl1152/bl1162 handlers).

## Architecture / boundaries

- Pure shift policy in `swarmShiftCore.ts` + mirror `swarm_shift_lib.bb`; cron
  I/O in `shift_schedule_applier_lib.bb` / `reconcile_shift_schedule_crontab.bb`
  / `apply_shift_schedule.bb` — shell owns crontab, bb renders from conf.
- `cooldownWindowCore.ts` and `nightClosingCeremony.ts` derive from active shift
  (BL-617 inverse, BL-658 closure) — no parallel schedule constants.
- APS handler `bl660ThreeShiftPacksSteps` registered in `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- Declared invariant encoded: `swarmShiftCore.property.test.js` (fast-check, all
  three packs; non-vacuous per staged-first break note) + `bl660_swarm_shift_property_runner.bb`.
- Coder-first authorship present; property bites (night closure 09:00 documented).

## Verification

- Dependency gate (`swarmShiftCore.ts`, `cooldownWindowCore.ts`, `nightClosingCeremony.ts`): **PASSED**
- `test_shift_schedule_applier.sh`: ALL CHECKS PASSED
- `swarm_shift_lib_test_runner.bb`: ALL TESTS PASSED
- `bl660_swarm_shift_property_runner.bb`: ALL INVARIANTS PASSED
- `swarmShiftCore.test.js`: 5/5; `test:properties` swarmShiftCore.property: 1/1

Inventory: NONE

Pass → hardender.

By architect.
