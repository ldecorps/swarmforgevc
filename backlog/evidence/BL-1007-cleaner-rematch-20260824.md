# BL-1007 cleaner rematch — 2026-08-24

## Inbound

Merged coder tip `c7b1131559` (parallel architect-bounce attribution fix:
`evidenceTestsAreAttributable`, smoke probe, wall÷factor instrumentation)
onto cleaner bounce-refix `4842764714` via `git merge --no-ff`. Conflicts
resolved in setup/steps/lib; duplicate `bl1007BudgetProbe.test.js` removed
in favour of `bl1007ContentionBudgetSmoke.test.js`.

## Checks

Properties 7/7; Gherkin 11/11.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention`.

By cleaner.
