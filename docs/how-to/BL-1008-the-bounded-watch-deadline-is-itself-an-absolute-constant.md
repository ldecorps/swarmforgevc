# Bounded fs.watch deadline follows recorded contention (BL-1008)

## The gap

BL-933 raced a real `fs.watch` event against a short deadline so a missing OS
event fails fast with a message naming the event and path — not a bare Vitest
timeout. That deadline was a bare `10000ms` constant. Under the same host load
that reddened unit-lane budgets (BL-1007), the real event arrived after 10s and
the diagnostic helper itself became the failure.

## What changed

`resolveBoundedWatchDeadlineMs` in `boundedWatchWait.js` uses BL-1007’s
`effectiveBudgetMs` on a 10000ms base (same quiet-host value), then clamps to
`testEffectiveBudget − 1` so Vitest never wins the race.

| Contention factor | Deadline |
| --- | --- |
| ≤1 or unusable | 10000ms (unchanged on a quiet box) |
| 3 | 30000ms |
| Extreme (clamped budget) | Still strictly below the test’s effective budget |

A missing event still rejects with
`real fs.watch event "<label>" on <path> did not arrive within <ms>ms`.

## Operator note

Sibling of BL-1007: do not raise the 10s constant alone. This helper must stay
shorter than the test timeout or BL-933’s diagnostic evaporates.

Acceptance:
`specs/features/BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant.feature`

Related: `docs/how-to/BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.md`.
