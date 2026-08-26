# BL-588 — architect pass — 20260826 (rematch 4)

- merge_and_process cleaner tip `9592012cea` (clean merge; tree **8854** paths).
- Fixes prior bounce D1: `batchRecovery.property.test.js` restored vitest globals
  (no `node:test` import) — property lane 3/3 green.

## Architecture / boundaries

- Unchanged from prior passes: pure `batchRecovery.ts` core, IO at CLI edge,
  BL-532 deferral consumption.
- Dependency gate: **PASSED**.
- BL-653 operator slice intact (`tick-observed-events`, `operator_enqueue_event.bb`).

## Invariants

- Encoded in `batchRecovery.property.test.js` (3/3 vitest properties) + unit/APS.

## Verification

- Unit: 16/16 vitest green.
- Property: 3/3 green (`npm run test:properties -- test/batchRecovery.property.test.js`).

Pass → hardender.

By architect.
