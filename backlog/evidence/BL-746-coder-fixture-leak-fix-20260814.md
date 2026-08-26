# BL-746 — coder pass, 2026-08-14 (fixture-leak fix)

## Scope

Received from architect as `merge_and_process architect d22b4cd80e` — a
D1 bounce (`backlog/evidence/BL-746-architect-bounce-20260814.md`):
`specs/pipeline/steps/lib/bl746StopSwarmFixture.js`'s `buildFixture()`
mkdtemps a fixture root and neither caller (the acceptance step handlers,
`bl746StopSwarmRealRefuseGatesSteps.js`; the property runner,
`bl746_stop_swarm_refuse_gate_property_runner.js`) ever removes it, unlike
this parcel's own cited precedent (`bl886SupervisorFixture.js`'s
`cleanupFixtureRoot`, called by both its callers every time).

## Fix

- `bl746StopSwarmFixture.js`: added `cleanupFixtureRoot(fixture)`
  (`fs.rmSync(fixture.root, {recursive: true, force: true})`), byte-for-
  byte the same shape as `bl886SupervisorFixture.js`'s own. Exported
  alongside the existing helpers.
- `bl746_stop_swarm_refuse_gate_property_runner.js`'s `runOne()`: calls
  `cleanupFixtureRoot(fixture)` right after capturing the result, before
  returning — mirrors `bl886_vitest_orphan_reaper_supervisor_property_
  runner.js`'s `runOne`/`runWorkerMidStringCase` exactly.
- `bl746StopSwarmRealRefuseGatesSteps.js`: every terminal `Then` step
  (`its exit status is non-zero` / `is <code>`, `its stderr names ... as a
  survivor`, `its output does not contain ...`, `its stdout contains the
  line ...`, `its stderr contains ...`) now calls
  `fixtureLib.cleanupFixtureRoot(fixture(ctx))` immediately after
  capturing `result`, before the assertion can throw — mirrors
  `bl886VitestOrphanReaperHotfixSteps.js`'s terminal-step cleanup
  placement. Each scenario in the feature file chains several of these
  `Then`/`And` steps against the same cached `ctx.bl746Result`, so calling
  cleanup from more than one of them per scenario is expected; it is safe
  because `fs.rmSync(..., {force: true})` no-ops on an already-removed
  root and every step reads only the already-captured result object, never
  the fixture root's filesystem contents, after the process has run.

## New unit test

`swarmforge/scripts/test/bl746_stop_swarm_fixture_cleanup_test.js` (new):
asserts `cleanupFixtureRoot` is exported, removes a fresh fixture's root,
and is idempotent when called twice. Confirmed red before the fix
(`cleanupFixtureRoot` undefined), green after.

## Measured — the leak is gone

```
$ ls "$TMPDIR" | grep -c 'bl746-stop-fixture-'
137
$ node swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js
bl746 stop-swarm refuse-gate property: 9 runs (exhaustive over 3 survivor shapes x 3 kill_rc values)
ALL PROPERTIES HOLD
$ ls "$TMPDIR" | grep -c 'bl746-stop-fixture-'
137
```

Before this fix the same command sequence measured `128 -> 137` (architect
bounce evidence); now `137 -> 137`, no growth.

## Full re-verification

- `node swarmforge/scripts/test/bl746_stop_swarm_fixture_cleanup_test.js` — PASS
- `node swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js` — 9/9 ALL PROPERTIES HOLD
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-746-stop-swarm-real-refuse-gates.feature` — 5/5 pass
- `bash swarmforge/scripts/test/test_lifecycle_script_scope.sh` — 15/15 PASS

Both declared invariants (BL-654) are unchanged by this fix and remain
covered exactly as the original coder pass recorded them (invariant 1:
stated-reason, non-encodable; invariant 2: the property runner above,
still exhaustive and green).

By coder.
