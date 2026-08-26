# BL-735 — cleaner pass — 20260825

- merge_and_process coder tip `c47971d943` (resolved conflicts in
  `pilotAcceptanceGate.ts`, `index.js`, `BL-782-coder-pass` evidence).
- Fix identified (not committed): remove `node:test` import from
  `bl735PilotAcceptanceExecution.property.test.js` for Vitest suite discovery
  (verified locally). BL-1124 blocks staging `*.property.test.js` on this host.
- Verification:
  - `pilotAcceptanceGate.test.js`: BL-735 refusal/land scenarios green
  - `bl735PilotAcceptanceExecution.property.test.js`: passes when run via Vitest

By cleaner.
