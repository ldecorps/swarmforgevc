# BL-1007 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `75db2c55e1` (unit-lane timeout scaled by recorded
contention factor via `contentionBudget.js` + setup; vitest.config reads
the helper) into `swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 75db2c55e1 HEAD`.

## Checks run

1. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.feature`:
   11/11 pass. Required wiring: steps in `index.js`;
   `vitest.config.mjs` requires `contentionBudget`.
2. **Properties** —
   `npx vitest run --config extension/vitest.properties.config.mjs test/bl1007ContentionBudget.property.test.js`:
   3/3 pass.

## Cleanup performed

- `contentionBudget.js`: extracted `usableFactor` so `effectiveBudgetMs`
  stays a thin clamp.
- `contentionBudgetSetup.js`: shared `persistEvidence`; early-return wrap
  for non-numeric timeouts.

## Findings beyond that

NONE material. Note: `loadNormalizedDurationMs` remains null until a
reporter fills wall/factor — scenario 03 only requires the field/list shape,
which holds. Inventory NONE beyond that observation.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention`.

By cleaner.
