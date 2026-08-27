# BL-1160 — architect pass — 20260826 (rematch 3)

- merge_and_process cleaner tip `145d18a4c0` (conflicts resolved — APS async
  `waitForVisibleTileDots`; `renderPane` paints `activitySignal` immediately;
  index.js keeps bl1153 + bl1159 + bl1160; tree post-merge).

## QA rematch2 remediation

- D1: APS steps now await visible dots after fetch/render tick; `renderPane`
  calls `updatePaneStatusDot` when `pane.activitySignal` present before aggregate.

## Verification

- `residentSpyUiHtml.test.js`: **18/18** vitest green.
- Dependency gate: **PASSED**.

Pass → hardender.

By architect.
