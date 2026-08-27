# BL-1007 cleaner bounce-refix — 2026-08-24

## Inbound

Merged architect bounce `ce0cbdb8f3` (`loadNormalizedDurationMs` must be
attributable, not permanently null). Ancestry:
`git merge-base --is-ancestor ce0cbdb8f3 HEAD`.

## Root cause

Setup pushed `loadNormalizedDurationMs: null` with no wall÷factor fill;
scenario 03 only checked list shape.

## Fix

- `loadNormalizedDurationMs(wall, factor)` in `contentionBudget.js`.
- `contentionBudgetSetup.js` wraps the test body, records wall÷max(1,factor)
  on completion (sync or promise).
- Acceptance drives `bl1007BudgetProbe.test.js` (explicit 5000ms literal)
  and asserts every `tests[]` entry has a finite normalized duration.
- Property locks the pure helper never returns null for valid walls.

## Checks

Properties 4/4; Gherkin 11/11.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention`.

By cleaner.
