# BL-1294 — cleaner pass — 20260902 (post-rework)

## Verdict: NONE — forward as-is.

Coder reworked to fix architect bounce D1 (leaked `liveDir`/`fixtureRoot`
scratch dirs in `bl1294FixtureScriptClosurePreservesDependencyPathsSteps.js`).

## Checks run

- `cleanupLiveAndFixtureDirs(ctx)` extracted once, called from all three
  scenario-terminal steps (lines 86, 98, 156) that use Background's
  `liveDir`/`fixtureRoot`; scenarios 01/02 call it inside `finally` so
  cleanup survives an assertion failure. Scenario 03's own `probe`/`root`
  dirs still clean up via their pre-existing pattern, now joined by the
  Background pair at line 156. Matches architect's remediation direction.
- `npx vitest run test/helpers/pinnedRepoFixture.test.js
  test/pinnedRepoFixture.test.js` — 16/16 pass.
- `node specs/pipeline/cli.js specs/features/BL-1294-*.feature` — 4/4
  acceptance scenarios pass.
- Confirmed no new leaked dirs: `ls /tmp | grep bl1294` after the acceptance
  run showed no directory timestamped at the run time — all pre-existing
  from before this fix.
- `jscpd` over the two touched files — 0 clones.
- No production (non-test, non-step-handler) code changed since the prior
  cleaner pass (`d73300c192`) other than this steps file, which is acceptance
  step-handler code (out of cleaner's mutation/CRAP/DRY-tool scope per
  cleaner.prompt "Does Not Own").

By cleaner.
