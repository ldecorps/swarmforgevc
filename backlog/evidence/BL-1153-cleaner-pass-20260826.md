# BL-1153 — cleaner pass — 20260826

- merge_and_process coder tip `281047e846` (merge commit `55c58c17f3`).
- DRY: `bl1153StickyWebFontSizeChoiceSteps.js` — shared `driveMiniAppReload`,
  `readCssVar` / `assertCssVar`, and `SURFACE_RELOAD` table for Pipeline Board /
  Paused pager reload scenarios; consolidated path constants (`REPO_ROOT`, `EXT`).
- Fix: restore `const { test } = require('node:test')` in
  `webUiFontSizePreference.test.js` (node --test runner).
- Verified: `npm run compile`; `node --test test/webUiFontSizePreference.test.js`
  (6/6 green). Src/property behavior unchanged — host preference file
  (`.swarmforge/operator/web-ui-font-size-preferences.json`) wired in coder tip.

By cleaner.
