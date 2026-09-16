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

## A heavy test's budget also grows with the lane's own fork count (BL-1607)

The lane-wide `contentionBudgetSetup.js` factor above is core-count
denominated (`loadavg1m / cpuCount`): right for the DEFAULT suite timeout,
but on a 20-core host that factor stays under 1 well past the load at
which a genuinely heavy, subprocess-spawning test (the shipped-step scan,
`bl1277UnscopedStepCollisionGuard.test.js`, ~24s alone) actually needs more
time — the same shape BL-1579/BL-1588 already found and fixed for the
property lane's own fixture-spawning files. BL-1600 gave that one scan
`resolveUnitLaneTimeout(20000).effectiveMs`, but with no fork count
published by the unit lane the factor stayed core-count-only and never
grew under real swarm contention, so the scan kept timing out.

`extension/test/helpers/unitLaneContentionBudget.js`'s
`unitLaneHeavyContentionFactor(opts)` reuses the property lane's own
`propertyLaneContentionFactor` (never a re-derivation) fed the UNIT
lane's own published fork count through that helper's existing `forksFn`
injection point, read from `SWARMFORGE_UNIT_LANE_FORKS` —
`vitest.config.mjs` sets that env key before any fork spawns, via the
property lane's `resolveLaneForks(process.argv, WORKER_POOL_SIZE)` (one
explicit file argument on the CLI resolves to one fork — a genuinely solo
run — the full glob or several files to the pool ceiling). The scan's
timeout is still `resolveUnitLaneTimeout(20000, { factor:
unitLaneHeavyContentionFactor() })` — the base and the helper call are
unchanged from BL-1600's own shape, only the factor now also sees the
lane's real concurrency, capped by the same 120000ms ceiling. A quiet
host with one fork still resolves exactly 20000ms.

This is a per-test route for the ONE test that needs it today, not a
change to the lane-wide default: `contentionBudgetSetup.js`'s core-count
rule is untouched, and a second heavy unit test surfacing is the signal to
generalise this route rather than one-off it again.

## Operator note

Do not “fix” load-artifact reds by raising absolute timeouts alone. Prefer this
relative budget. Extreme contention still fails past the ceiling rather than
granting unbounded time.

The bounded `fs.watch` wait helper (`boundedWatchWait.js`) is scaled the same
way and kept strictly below the test budget — see
`docs/how-to/BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant.md`.

Acceptance:
`specs/features/BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.feature`
