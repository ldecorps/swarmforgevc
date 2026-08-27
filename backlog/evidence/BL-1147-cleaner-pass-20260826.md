# BL-1147 — cleaner pass — 20260826

- merge_and_process coder tip `93c08f1e82` (clean merge).
- Read-only probe module `probeLegacyTopicAdoption.ts` — structure clean, no
  cleaner refactor needed.
- Fix identified (not committed): remove `node:test` import from
  `bl1147ProbeLegacyTopicAdoption.property.test.js` for Vitest discovery
  (BL-1124 blocks property-test commits on this host).
- Verification:
  - `bl1147ProbeLegacyTopicAdoption.test.js`: unit scenarios green
  - Property tests pass when Vitest global `test` is used

By cleaner.
