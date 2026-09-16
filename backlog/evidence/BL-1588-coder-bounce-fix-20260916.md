# BL-1588 — coder fix for the architect's bounce, 2026-09-16

## The defect (architect bounce, `backlog/evidence/BL-1588-architect-bounce-20260916.md`)

`vitest.properties.config.mjs` published `WORKER_POOL_SIZE` — the lane's
static pool CEILING, sized from host RAM/cores alone, identical whether
the invocation targets 408 files or 1 — as the "forks" signal. On a host
with enough free capacity, a genuinely solo single-file run resolved a
pool ceiling well above `QUIET_LOAD_CEILING` (e.g. 12), giving
`forkFactor = 12/4 = 3` and inflating a declared-strict-20s run to 60000ms
— invariant 1 violated in practice, not just in theory. The architect's
own evidence cited this coder's own "20-of-20 alone" table
(`bl1315OwnPathsFullRangeInvariants` at 27.55s, over the nominal 20s
base) as proof this had already happened.

## The fix

`propertyLaneContentionBudget.js` adds two pure, exported functions:

- `explicitFileArgCount(argv)` — the number of explicit test-file
  arguments on the vitest CLI invocation (`vitest run --config <cfg>
  test/a.js test/b.js` → 2; `vitest run --config <cfg>` → 0, the full
  lane's own glob). `--config`'s value is the one flag skipped by name;
  every other `-`-prefixed token is a bare flag, never counted as a file.
- `resolveLaneForks(argv, poolSize)` — the pool ceiling only when more
  than one file could actually be running concurrently (0 or >1 explicit
  files); exactly one explicit file forces `forks = 1`, indistinguishable
  from a genuinely solo run.

`vitest.properties.config.mjs` now publishes
`resolveLaneForks(process.argv, WORKER_POOL_SIZE)` instead of the raw
`WORKER_POOL_SIZE`. `maxForks` (Vitest's own actual pool sizing) is
unchanged — only the BUDGET signal narrows. The full-lane invocation
(`npm run test:properties`, 0 explicit files) is unaffected: it still
resolves the pool ceiling exactly as before.

Three new property tests in
`bl1588PropertyLaneBudgetConcurrencyInvariant.property.test.js` cover the
gap the architect named specifically: the first two exercise
`explicitFileArgCount`/`resolveLaneForks` as pure functions; the third
sets `process.env[SWARMFORGE_PROPERTY_LANE_FORKS]` via the REAL
`resolveLaneForks` output and calls `propertyLaneTimeoutMs` with NO
`forksFn` override, so it exercises the real
`vitest.properties.config.mjs` → env-var → `forksFromEnv()` wiring, not
only the pure function with a hand-injected `forksFn` (the exact gap the
architect named in the original invariant-1 test). Non-vacuity confirmed
by reintroducing the bug (`resolveLaneForks` always returning `poolSize`)
and observing 2 of the new tests fail exactly on the scenario the
architect described (`a solo invocation with pool ceiling 5 received
25000ms through the real env wiring, not the strict base`), then
restoring.

## Re-verification under the corrected, genuinely strict budget

The previous "20-of-20 alone" claim was made under the buggy code, which
silently granted up to 60000ms to what should have been a strict 20000ms
solo run — so it did not actually prove invariant 1. Re-run in full after
the fix, sequentially (not in parallel, to avoid self-inflicted host
contention muddying the "solo" measurement):

| file | runs | FAIL | max per-TEST duration (not file wall-clock) |
|---|---|---|---|
| bl1308SiblingDetectorCoversReplay | 20/20 green | 0 | 19260ms |
| bl1315OwnPathsFullRangeInvariants | 20/20 green | 0 | 17548ms |
| bl1343ReplayNeverDropsOwnPathInvariants | 20/20 green | 0 | 8692ms |
| bl1354SharedPathLandedSiblingInvariants | 20/20 green | 0 | 5451ms |

(`extension/tmp/bl1588-v2-alone-*.log`, not committed — gitignored scratch,
per the tmp/ convention.) Every max is comfortably under the 20000ms
strict base, confirming the invariant now genuinely holds for a solo run,
not merely appears to under an inflated budget.

5 full-lane runs post-fix (`npm run test:properties`,
`extension/tmp/bl1588-v2-fulllane-{1..5}.log`): none of the four named
files, `bl1343` or `bl1323` (BL-1579) failed in any of the 5 runs. Every
run's only recurring failure is `bl1280MkdtempMigrationInvariants`
(BL-1593, unlanded). Run 1 additionally hit `bl1529` (BL-1592) and a NEW
file not previously seen, `telegramFrontDeskBotCli.property.test.js`
(`Error: Test timed out in 60000ms.`, its own bare timeout argument, same
class as `bl1529`) — reported separately, out of this ticket's scope
(`backlog/evidence/BL-1588-coder-unowned-red-telegramFrontDeskBotCli-20260916.md`).
Run 5 additionally hit `bl1529` again. Neither is BL-1588's four named
files or `bl1343`/`bl1323`.

## Acceptance

`swarmforge/scripts/run_acceptance.sh
specs/features/BL-1588-fixture-spawning-property-files-time-out-in-a-full-lane-run.feature`
— 11/11 scenarios pass, re-run after the fix.
