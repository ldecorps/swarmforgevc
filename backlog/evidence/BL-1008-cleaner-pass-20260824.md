# BL-1008 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `a54cc7ebdf` (scale BL-933 `boundedWatchWait` deadline
with BL-1007 contention factor; keep quiet-host 10000ms base; clamp
strictly below the test effective budget) into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry: `git merge-base --is-ancestor a54cc7ebdf HEAD`.

Merge conflict resolution (keep BL-1007 attribution surface):
- `extension/test/helpers/contentionBudgetSetup.js` — ours
- `specs/pipeline/steps/bl1007ContentionBudgetSteps.js` — ours
- Restored `extension/test/bl1007ContentionBudgetSmoke.test.js` (coder tip
  deleted it; still required by BL-1007 acceptance)

Parcel surface taken from the tip:
- `extension/test/helpers/boundedWatchWait.js` (+ unit tests)
- `extension/test/bl1008BoundedWatchDeadline.property.test.js`
- `specs/pipeline/steps/bl1008BoundedWatchDeadlineSteps.js`
- `specs/pipeline/steps/index.js` (register wiring)
- ticket paused → active

## Checks run

1. **Helper unit** —
   `npx vitest run test/helpers/boundedWatchWait.test.js`: pass.
2. **Properties** —
   `npx vitest run --config vitest.properties.config.mjs test/bl1008BoundedWatchDeadline.property.test.js`:
   3/3 pass.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant.feature`:
   8/8 pass. Required wiring: steps in `index.js`; helper reads
   `contentionBudget`.
4. **Quiet-host regression** —
   `npx vitest run test/bounceWatcher.test.js`: 35/35 pass.
5. **BL-1007 smoke preserved** —
   `npx vitest run test/bl1007ContentionBudgetSmoke.test.js`: 1/1 pass.

## Cleanup performed

NONE — helper already thin (resolve + race); no further extract warranted.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant`.

By cleaner.
