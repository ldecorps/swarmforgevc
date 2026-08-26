# BL-588 — architect bounce — 20260826 (rematch 3)

- Attempted merge_and_process cleaner tip `9fecc16389` (Specification.MD
  changelog conflict resolved; tree 8854 paths; BL-653 slice preserved).
- Reverted merge `d12732104` — property lane defect blocks forward.

## Inventory (one bounce)

### D1 — unit/property: `batchRecovery.property.test.js` breaks vitest property lane

**Sites**

1. `extension/test/batchRecovery.property.test.js` — cleaner rematch added
   `const test = require('node:test')`. Under `npm run test:properties`
   (vitest.properties.config.mjs), vitest reports:
   `Error: No test suite found in file .../batchRecovery.property.test.js`
   and counts the file as a **failed suite** (0 tests registered), even though
   node:test hooks may fire.
2. Prior rematch pass used vitest globals (no node:test import) and property
   lane was 3/3 green.

**Required remediation**

- Property tests in `*.property.test.js` must register with the vitest property
  runner (same discipline as other property files — no bare `node:test` import
  that vitest cannot collect). Unit lane (`batchRecovery.test.js`) may keep
  vitest globals separately.
- Confirm `npm run test:properties -- test/batchRecovery.property.test.js` green
  before re-handoff.

## Not bounced (verified on isolated merge before revert)

- Tree additive (8854 paths); BL-653 operator scripts/symbols intact.
- Dependency gate PASSED; unit 16/16 green.
- BL-588 architecture unchanged (pure core + CLI IO).

Bounce → coder (`behavior`).

By architect.
