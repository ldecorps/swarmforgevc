# BL-752 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `01c76572da` (BL-694 Outline 04 non-stage Examples row,
scoped BL-694 steps, BL-752 acceptance for the previously-dead handler) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 01c76572da HEAD`.

## Checks run

1. **Gherkin acceptance (BL-752)** —
   `node specs/pipeline/cli.js specs/features/BL-752-residual-allowlist-non-stage-backlog-path-is-tested.feature`:
   3/3 pass.
2. **Gherkin acceptance (BL-694 regression)** —
   `node specs/pipeline/cli.js specs/features/BL-694-residual-word-allowlist-survives-stage-moves.feature`:
   9/9 pass.

## Cleanup performed

- `onboarderResidualAllowlist.js`: grandfather
  `specs/pipeline/steps/bl752ResidualAllowlistNonStageSteps.js` on the exact-
  path allowlist (same posture as the BL-694 step file) so the residual-word
  scan does not fail closed on the new fixture that must mention the retired
  basename.
- `bl752ResidualAllowlistNonStageSteps.js`: split outline rendering into
  small helpers (`stepTextFromLine`, `parseExampleTable`,
  `outlineStepTemplates`, `expandOutlineBlock`) so each stays under the CC
  budget.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-752-bl694-unreachable-step-handler-untested-non-stage-basename-case`.

By cleaner.
