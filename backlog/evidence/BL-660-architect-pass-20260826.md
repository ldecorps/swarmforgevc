# BL-660 — architect pass — 20260826

- merge_and_process cleaner tip `68d0fdd918` (index.js conflict — kept both
  BL-653 and BL-660 step registrations).
- Tree preserved: **8852** tracked paths (additive merge).

## Architecture / boundaries

- Pure shift schedule in `swarm_shift_lib.bb` (Babashka) + mirrored
  `swarmShiftCore.ts` (TypeScript); consumers (`cooldownWindowCore.ts`,
  `nightClosingCeremony.ts`, `apply_shift_schedule.bb`) depend inward on the
  single shift definition — no orphaned schedule constants.
- Dependency gate (BL-660 TS sources): **PASSED**.
- Co-change: expected shift-pack cluster coupling; no forbidden view/host-IO edges.

## Invariants

1. **Every schedule-derived clock reads the active shift** — encoded by
   `bl660_swarm_shift_property_runner.bb` (ALL INVARIANTS PASSED) +
   `swarm_shift_lib_test_runner.bb` + `swarmShiftCore.test.js` (5/5).

## Required wiring

- APS `bl660ThreeShiftPacksSteps` registered in `index.js`.

## Property-testing pass

- Babashka property runner covers declared invariant; TS `swarmShiftCore` has
  unit tests. No additional `*.property.test.js` needed — invariant encoded in
  dedicated property runner (non-vacuous: fails if clocks drift off shift).

## Verification

- `swarm_shift_lib_test_runner.bb`: ALL TESTS PASSED
- `bl660_swarm_shift_property_runner.bb`: ALL INVARIANTS PASSED
- `swarmShiftCore.test.js`: 5/5 vitest green

Pass → hardender.

By architect.
