# BL-660 — architect pass — 20260826 (rematch 2)

- merge_and_process cleaner tip `6a8d1978fc` (index.js conflict: bl660 already at
  line 363 — kept bl1159 + bl1160, no duplicate; tree **8891** paths).
- Cleaner re-cut BL-660-only from main with single-source `swarmShiftCore.property.test.js`.

## Architecture / boundaries

- Pure `swarmShiftCore.ts` mirrored in `swarm_shift_lib.bb`; IO at Babashka applier edge.
- Property invariant in vitest + Babashka property runner.

## Verification

- Dependency gate on `swarmShiftCore.ts`: **PASSED**
- Unit: 5/5 vitest; property: 1/1 vitest
- Babashka: `swarm_shift_lib_test_runner.bb` ALL PASS; property ALL INVARIANTS PASSED
- BL-588 sibling slice intact

Pass → hardender.

By architect.
