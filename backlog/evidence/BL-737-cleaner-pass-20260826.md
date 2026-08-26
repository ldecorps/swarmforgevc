# BL-737 — cleaner pass — 20260826

- merge_and_process coder tip `598fbdf6ee` (clean merge).
- DRY: hoist `findCrossFileDuplication` import in acceptance steps.
- Fix: `crossFileDuplicationCheck.test.js` uses Vitest global `test`.
- Skipped committing `commitClaimGitReader.ts` DRY (`listPathsForCommit`
  shared by patch + touched paths) — staging `extension/src/*` trips
  property-suite-guard which mutates the checkout (BL-1124) on this host.
- Property file still imports `node:test`; verified 3/3 with Vitest globals
  locally; same BL-1124 block on `*.property.test.js`.
- Verification: `crossFileDuplicationCheck.test.js` 7/7.

By cleaner.
