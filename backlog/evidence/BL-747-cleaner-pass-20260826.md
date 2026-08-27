# BL-747 — cleaner pass — 20260826

- merge_and_process coder tip `d577fe97b2` (fast-forward).
- Pure `shellEntryPointDriveCheck` module is already well-factored (comment
  strip, extractNamedEntryPoints, assessShellEntryPointDrive); no src refactor.
- Fix: `shellEntryPointDriveCheck.test.js` uses Vitest global `test`.
- Property file still imports `node:test` — BL-1124 blocks committing
  `*.property.test.js` / `extension/src/*` on this host.
- Verification: `shellEntryPointDriveCheck.test.js` 8/8.

By cleaner.
