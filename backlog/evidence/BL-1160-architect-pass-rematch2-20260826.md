# BL-1160 — architect pass — 20260826 (rematch 2)

- merge_and_process cleaner tip `0e0dd470cc` (conflicts resolved — kept QA dot-repaint
  fix: `removeAttribute('hidden')` on apply, `setAttribute('hidden')` on hide,
  `updatePaneStatusDot` on `renderPane`; index.js keeps bl1153 + bl1159 + bl1160;
  tree **8882** paths).

## QA bounce remediation

- D1/D2: per-tile dots now visible on grid refresh via `lastAggregateStatus` repaint
  in `renderPane` and explicit hidden-attribute toggling in `applyDotState`/`hideDot`.
- D3: cleaner re-cut BL-1160-only from main (`0e0dd470cc`).
- D4: `bl1153StickyWebFontSizeChoiceSteps` retained alongside BL-1160.

## Verification

- `residentSpyUiHtml.test.js`: **18/18** vitest green (5 BL-1160 + BL-1153 reload).
- Dependency gate: **PASSED**.

Pass → hardender.

By architect.
