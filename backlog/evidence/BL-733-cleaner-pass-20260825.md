# BL-733 — cleaner pass — 20260825

- merge_and_process coder tip `f5d4d22c7c` (clean merge).
- Fix identified (not committed): remove `node:test` import from
  `bl733ProducerCrosscheck.property.test.js` so Vitest discovers suites (3/3
  when run directly). Pre-commit property-suite-guard mutates checkout
  (BL-1124) when staging `*.property.test.js` on this host — forward for
  architect/hardener to land that one-line fix or run property lane off main.
- DRY: simplify receipt crosscheck assertion in `bl733PilotProducerCrosscheckSteps.js`.
- Verification:
  - `bl733ProducerCrosscheck.property.test.js`: 3/3
  - `pilotAcceptanceGate` unit tests: green for BL-733 scenarios

By cleaner.
