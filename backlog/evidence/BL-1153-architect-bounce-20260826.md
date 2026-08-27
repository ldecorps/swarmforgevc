# BL-1153 — architect bounce — 20260826

- merge_and_process cleaner tip `d86afc62fd` (clean merge).
- dependency-gate on parcel bridge sources: **PASSED**.
- Host-persisted preference (`webUiFontSizePreference.ts` +
  `/web-ui-font-size` routes), shared Mini App script, pipeline/paused wired;
  live-screen uses fetch seam; no localStorage in BL-1153 HTML generators.

## Inventory (one bounce)

### D1 — unit: `residentSpyUiHtml.test.js` does not run under `node --test`

**Sites**

1. `extension/test/residentSpyUiHtml.test.js` — uses `test()` with no
   `const { test } = require('node:test')`; `ReferenceError: test is not defined`
   at load (line 79). Entire suite red, including BL-1153 additions:
   - `BL-1153: Live Screen pane font size survives a full Mini App reload`
   - rule3 grep (`assert.doesNotMatch(html, /localStorage|sessionStorage/)`)
2. Cleaner verified only `webUiFontSizePreference.test.js` (6/6); did not
   restore `node:test` in the touched `residentSpyUiHtml.test.js` (same fix
   pattern as cleaner applied to `webUiFontSizePreference.test.js`).

**Required remediation**

Add `node:test` import to `residentSpyUiHtml.test.js` (and confirm
`node --test test/residentSpyUiHtml.test.js` green including BL-1153 cases).

## Not bounced (noted)

- `webUiFontSizePreference.test.js` 6/6 covers corrupt/missing fallback
  (invariant 2) in unit lane; APS covers Rule-3 seam statically.
- PWA unchanged scenario deferred to acceptance (documented out of unit scope).

Bounce → coder (`unit`).

By architect.
