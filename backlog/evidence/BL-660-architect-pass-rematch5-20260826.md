# BL-660 — architect pass (rematch5) — 20260826

- QA bounce D1 recut: detached review at cleaner tip `38622b63f5` (27 paths vs
  `origin/main`; zero BL-653/588/1162/1152 hitchhikers).
- Did **not** merge recut into stacked architect branch (re-pollution guard).

## Architecture / boundaries

- Pure shift policy in `swarmShiftCore.ts` + mirror `swarm_shift_lib.bb`; cron
  I/O in `shift_schedule_applier_lib.bb` / `apply_shift_schedule.bb`.
- `cooldownWindowCore.ts` and `nightClosingCeremony.ts` derive from active shift
  (BL-617 inverse, BL-658 closure) — no parallel schedule constants.
- APS handler `bl660ThreeShiftPacksSteps` registered in `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- `bl660_swarm_shift_property_runner.bb`: ALL INVARIANTS PASSED.
- Coder-first authorship present; property bites documented.

## Verification

- Dependency gate (`swarmShiftCore.ts`, `cooldownWindowCore.ts`, `nightClosingCeremony.ts`): **PASSED**
- `test_shift_schedule_applier.sh`: ALL CHECKS PASSED
- `swarm_shift_lib_test_runner.bb`: ALL TESTS PASSED
- `swarmShiftCore.test.js`: 5/5 green

Inventory: NONE

Pass → hardender (clean tip only).

By architect.
