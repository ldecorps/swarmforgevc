# Unit-lane budgets scale with recorded contention (BL-1007)

## The gap

Absolute Vitest timeouts encode the host load they were measured at. On a quiet
box a 20s default is fine; at 25–45× core count with the swarm live, the same
unchanged tests take longer and fail — prompting another measured raise (four
in four days). The verdict was not wrong; the load silently changed.

## What changed

Compile-free helper `specs/pipeline/steps/lib/contentionBudget.js` (usable from
`extension/vitest.config.mjs` before `tsc`):

| Concept | Behaviour |
| --- | --- |
| Contention factor | `loadavg1m / cpuCount` (null / unusable → treat as quiet) |
| Effective budget | `base` when factor ≤1 or unusable; else `min(ceiling, base × max(1, factor))` |
| Ceiling | Finite absolute cap (`UNIT_LANE_BUDGET_CEILING_MS` = 120000) |
| Attribution | Run evidence records the factor and each budgeted test's load-normalized duration (`wall ÷ max(1, factor)`). Setup instruments timed bodies so every budgeted entry is finite after the run — all-null evidence is rejected (`evidenceTestsAreAttributable`). |

`vitest.config.mjs` sets the suite default via `resolveUnitLaneTimeout(20000)`.
`contentionBudgetSetup.js` scales per-test numeric timeout literals at runtime
while leaving the **base literal** in source for BL-969/BL-999 guards.

On a quiet host the effective budget equals the base — genuine regressions
still red. Property lane is **not** scaled (birpc heartbeat ceiling).

## Operator note

Do not “fix” load-artifact reds by raising absolute timeouts alone. Prefer this
relative budget. Extreme contention still fails past the ceiling rather than
granting unbounded time.

The bounded `fs.watch` wait helper (`boundedWatchWait.js`) is scaled the same
way and kept strictly below the test budget — see
`docs/how-to/BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant.md`.

Acceptance:
`specs/features/BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.feature`
