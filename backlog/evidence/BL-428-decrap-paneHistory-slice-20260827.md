# BL-428 — paneHistory module decrap slice — 20260827

## Scope

Module-scoped decrap slice per BL-428 policy §2: `extension/src/panel/paneHistory.ts`
(+ parity `media/panel.js`).

## Target

`detectFooterLineCount` — was CRAP **15.03** (complexity=15, coverage=95%).

## After refactor

All paneHistory.ts functions CRAP ≤ 6 (scoped run via `node scripts/crapReport.js src/panel/paneHistory.ts` after targeted vitest coverage):

| function | complexity | coverage | CRAP |
|---|---:|---:|---:|
| detectFooterLineCount | 3 | 100% | 3.00 |
| findPromptLineIndex | 5 | 100% | 5.00 |
| tryExtendFooterLine | 4 | 87% | 4.04 |
| extendFooterEnd | 4 | 100% | 4.00 |

## Tests (unchanged behavior)

- `test/paneHistory.test.js` (42 scenarios incl. one new fall-through branch)
- `test/footerDetectionParity.test.js` (panel.js ↔ TS parity)
- `test/footerAwareScroll.test.js`

Pure refactor — no acceptance scenario changes.

By coder@cursor2.
