# BL-693 — coder, response to cleaner's bounce, 2026-09-18

Bounce: `backlog/evidence/BL-693-bounce-cleaner-20260918.md`. Finding:
`bl693DocsDuplicateParagraphGuardSteps.js`'s `mkFixtureRoot()` (called
from scenarios 02-05) had no cleanup - 11 permanent directories confirmed
leaked from one acceptance run.

## Fix

Applied the same `fixtureReaper.js` `onAbnormalExit`-tracked pattern this
handler's own siblings already use (`bl1624StandingShellTestNeverDiffs
AgainstMainSteps.js`, `bl1626PromotionFixturesCarryTheClosureSteps.js`,
`bl1632Bl1071ProbeCountsOnlyItsOwnFixturesHangsSteps.js`):
- `mkFixtureRoot(ctx)` now takes the scenario's `ctx` and stashes
  `ctx.cleanupBl693Root = trackDir(root)` at creation.
- `onAbnormalExit` registered once at module scope, sweeping every still-
  tracked directory if the process dies mid-scenario.
- Inline cleanup in a `finally` at each scenario's own TERMINAL step -
  three distinct locations, since "the guard passes" is the shared
  terminal step for scenarios 01 (real docs dir, no fixture - cleanup
  correctly no-ops), 03, and 04, while scenarios 02 and 05 have their own
  distinct terminal steps ("removing all but one copy clears the
  report", "the report names the second file"). `cleanupFixtureRoot(ctx)`
  tolerates an absent `ctx.cleanupBl693Root` so the shared step works for
  both fixture-rooted and real-tree scenarios without a second code path.

## Verified

- `rm -rf /tmp/bl693-acc-*` then
  `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-693-*.feature`
  — 13/13 green; `ls -d /tmp/bl693-acc-*` afterward finds nothing (zero
  leaked directories, was 11 before the fix).
- `npx vitest run test/docsDuplicateParagraphGuard.test.js` — 20/20
  green, unaffected (this fix is handler-only).
- `npm test` (626 files, 10717 tests) — one run hit an unrelated,
  unidentified single test timeout (`bl968StepRegistryMaterializedTreeGuard
  .test.js` invariant 2, 60s) during an observed severe host load spike
  (load average 22.3, the highest this whole session; the fork pool
  collapsed to 2 forks); re-ran that one file in isolation immediately
  after and it passed cleanly (3/3, 45s) - confirms host-load noise, not
  a regression, and unrelated to this parcel's own files. A separate
  earlier clean run (before the spike) showed 626/626 files, 10697/10697
  tests, `suite file budget OK`.
- `npm run test:properties` — 418 files (was 417; gains
  `bl693DocsDuplicateParagraphInvariants.property.test.js`), 1225/1225
  green (5 errors, the allowlisted BL-871 `onTaskUpdate` timeout, elevated
  under the same load spike but still within the allowlisted class).

By coder.
