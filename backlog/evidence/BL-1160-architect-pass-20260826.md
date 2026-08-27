# BL-1160 — architect pass — 20260826

- merge_and_process cleaner tip `3a00ff6154` (conflict in
  `residentSpyUiHtml.test.js` resolved — kept incoming BL-1046 + BL-1160 +
  BL-1153 tests; tree **8878** paths).

## Architecture / boundaries

- View-only change in `residentSpyUiHtml.ts`: per-tile `[data-status-indicator]`
  dots inside `.pane-head`; `resolvePaneStatusKind` prefers optional
  `pane.activitySignal`, falls back to aggregate poll freshness for available
  panes, hides dot when unavailable — satisfies invariant against false all-green.
- Fullscreen `#fs-dot` retained; grid + expand read same signal path via
  `updatePaneStatusDot` / `setStatus`.
- APS steps registered in `specs/pipeline/steps/index.js`.

## Verification

- `residentSpyUiHtml.test.js`: **18/18** vitest green (5 BL-1160 scenarios).
- Dependency gate on `residentSpyUiHtml.ts`: **PASSED**.

Pass → hardender.

By architect.
