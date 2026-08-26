# BL-660 — architect pass (rematch) — 20260826

- merge_and_process cleaner tip `33101aa2c6` (clean merge; tree **8857** paths).
- Restores shift-pack TS modules (`swarmShiftCore.ts`, `cooldownWindowCore.ts`,
  `nightClosingCeremony.ts`) after BL-588 hitchhiker scrub deleted them.

## Architecture / boundaries

- Pure shift schedule mirrored Babashka ↔ TS; consumers depend inward.
- Dependency gate (BL-660 TS sources): **PASSED**.

## Invariants

- `bl660_swarm_shift_property_runner.bb`: ALL INVARIANTS PASSED.

## Verification

- `swarm_shift_lib_test_runner.bb`: ALL TESTS PASSED
- `swarmShiftCore.test.js`: 5/5 green
- BL-588 + BL-653 artifacts still present on branch.

Pass → hardender.

By architect.
