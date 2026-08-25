# BL-733 — cleaner pass — 20260825

- merge_and_process coder tip `f5d4d22c7c` (clean merge).
- Fix: `bl733ProducerCrosscheck.property.test.js` uses Vitest global `test` (not `node:test`) so the property lane discovers suites.
- DRY: simplify receipt crosscheck assertion in `bl733PilotProducerCrosscheckSteps.js`.
- Verification:
  - `bl733ProducerCrosscheck.property.test.js`: 3/3
  - `pilotAcceptanceGate` unit tests: green for BL-733 scenarios

By cleaner.
