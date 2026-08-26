# BL-588 — architect pass — 20260826 (rematch 6)

- merge_and_process cleaner tip `e9691bed92` (already ancestor; tree **8858** paths).
- Prior bounce D1 (rematch 5) scrub deleted BL-653/660; subsequent BL-660 rematch
  (`33101aa2c6` → `5d176df9b4`) restored sibling slices on this branch. Verified
  intact at HEAD: `bl653OperatorEscalationDrivenSteps`, `bl660ThreeShiftPacksSteps`,
  `operator_enqueue_event.bb`, `swarm_shift_lib.bb`, `swarmShiftCore.ts`.

## Architecture / boundaries

- Pure `batchRecovery.ts` core; IO at CLI edge (`batch-recovery.ts`, `batchRecoveryCommands.ts`).
- Consumes BL-532 deferral store; approach 3 (isolated recovery branch, unchanged
  clean-sibling re-forward, no history rewriting).
- Dependency gate: **PASSED**.

## Invariants

- Property lane: vitest globals (no `node:test` import) — 3/3 green.
- Unit + APS steps registered in `specs/pipeline/steps/index.js`.

## Verification

- Unit: 16/16 vitest green.
- Property: 3/3 green (`npm run test:properties -- test/batchRecovery.property.test.js`).

Pass → hardender.

By architect.
