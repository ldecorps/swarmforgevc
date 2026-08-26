# BL-746 — architect bounce — 2026-08-14

## Scope

Received from QA as `merge_and_process QA fd2e742bd0` — a procedural bounce
(same shape as BL-891's: `backlog/evidence/BL-746-qa-bounce-20260814.md` D1
found no architect commit anywhere in the chain, no `stage_skip_reasons`
entry). QA independently re-verified the test suites sound and requested
either a genuine architect pass or a documented skip — no code changes
requested by QA's own bounce.

This is that genuine pass, reviewing coder's `7f30ede4d` (BL-746: rewrite
stop-path tests to drive the real stop-swarm.sh) fresh, from scratch, per
Article 1.5 / architect.prompt's Review Order. Unlike BL-891, this pass
finds a real defect — Article 4.4 applies: complete the whole checklist,
one bounce, naming everything found.

## D1 — fixture root leaked on every run; deviates from this parcel's own
   cited precedent, uncovered by the fixture reaper

1. **Failing command**: not a single failing test — a resource-leak defect
   proven by direct measurement, not a red assertion.
   `ls "${TMPDIR:-/tmp}" | grep -c 'bl746-stop-fixture-'`

2. **Commit hash checked out and tested**: `d1970aa10` (this worktree,
   after merging QA's bounce `fd2e742bd0` and restoring the BL-891 files
   that merge collaterally deleted — see the separate hygiene commit on
   this branch; unrelated to this defect).

3. **Evidence, measured**:
   - Before running anything of this ticket's own suites: 128
     `bl746-stop-fixture-*` directories already present under `$TMPDIR`
     (residue from the coder/cleaner/hardener/documenter/QA's own required
     re-runs of these same suites today).
   - `node swarmforge/scripts/test/bl746_stop_swarm_refuse_gate_property_runner.js`
     → `9 runs ... ALL PROPERTIES HOLD` (the suite itself is correct).
   - Immediately after, same count: **137** — exactly `128 + 9`, one
     leaked directory per exhaustive property-matrix run, none reclaimed.
   - Root cause read in source: `specs/pipeline/steps/lib/
     bl746StopSwarmFixture.js`'s `buildFixture()` (`fs.mkdtempSync(...)`)
     has no paired removal anywhere in the file, and exports no cleanup
     function at all (`module.exports = { buildFixture, writeKillStub,
     setSurvivor, setNoSurvivors, runStopSwarm }` — no `cleanupFixtureRoot`
     or equivalent). Both of this file's two callers —
     `bl746StopSwarmRealRefuseGatesSteps.js` (the acceptance step handlers,
     one fixture built per scenario via `fixture(ctx)`) and
     `bl746_stop_swarm_refuse_gate_property_runner.js` (9 fixtures per
     run, one per `runOne` call) — never call `fs.rmSync` on the fixture
     root either. Every scenario run and every property-matrix run leaks
     one temp directory, permanently.
   - This is not merely inconsistent with house style — it deviates from
     a precedent THIS SAME PARCEL explicitly cites as its model. The
     property runner's own header comment says: *"EXHAUSTIVE (not
     sampled), per bl886_vitest_orphan_reaper_supervisor_property_
     runner.js's own precedent"*. That precedent's shared fixture lib,
     `specs/pipeline/steps/lib/bl886SupervisorFixture.js`, exports
     `cleanupFixtureRoot(fixture)` (`fs.rmSync(fixture.root, {recursive:
     true, force: true})`), and BOTH of its own callers call it every
     time: the property runner (`swarmforge/scripts/test/
     bl886_vitest_orphan_reaper_supervisor_property_runner.js`) calls it
     at the end of every `runOne`/`runWorkerMidStringCase` iteration, and
     the acceptance step handlers (`bl887ConsolidateProcessScopePredicate
     Steps.js`, `bl886VitestOrphanReaperHotfixSteps.js`) call it inside
     their own terminal `Then` steps before the final assertion. BL-746's
     fixture lib copied the shape (mkdtemp-per-fixture, shared between a
     property runner and step handlers) but not the cleanup half of it.
   - Not covered by the standing reaper either: `swarmforge/scripts/
     fixture_reaper_lib.bb`'s `known-fixture-prefixes` allowlist is
     `["aps-" "sfvc-" "bl404-front-desk-"]` — `bl746-stop-fixture-` is not
     in it (nor, notably, is `bl886-`/`bl887-`, but those never need the
     sweep since they self-clean synchronously). A `bl746-stop-fixture-*`
     directory is never reaped by anything in this codebase; it sits under
     `$TMPDIR` until a human or the OS temp-cleaner removes it, which on a
     long-lived dev/CI machine (this one, mid-shift, is the actual
     evidence) means unbounded accumulation across every pipeline stage's
     required re-run of this suite.

4. **Failure class**: `behavior` — a real resource-leak defect in the
   parcel's own test infrastructure, not a missing-gate procedural issue
   (that part of QA's original bounce is separately satisfied by this pass
   existing at all).

5. **Expected vs observed**: Expected — `bl746StopSwarmFixture.js` exports
   a `cleanupFixtureRoot` (or equivalently named) function, and both
   `bl746StopSwarmRealRefuseGatesSteps.js`'s terminal step(s) and
   `bl746_stop_swarm_refuse_gate_property_runner.js`'s per-iteration loop
   call it, mirroring `bl886SupervisorFixture.js`'s own established shape
   exactly (this parcel's own cited precedent). Observed — no such
   function exists, no caller ever removes a fixture root, and the leak is
   directly measured growing by one directory per run, permanently
   unreaped.

## Everything else checked — no other defects found

- **Invariant 1** ("no stop-path scenario derives its expected output from
  a reimplementation of the branching") — read the actual diff in
  `test_lifecycle_script_scope.sh`: the old inline `source
  stack_survivor_scan.sh; if stack_survivor_scan; then ... else echo "full
  stack SUCCESS — clean slate"` blocks are gone from scenarios 04/05/04c/06;
  all four now call the shared `run_stop_fix` helper, which shells the
  real, byte-identical-copied `stop-swarm.sh` and asserts on its actual
  `$BL746_OUT`/`$BL746_RC`. Scenarios 04a/05a/04b (unit tests of
  `stack_survivor_scan.sh` itself) are untouched, matching the ticket's own
  declared scope split. The claimed non-encodability of invariant 1 (a
  source-shape claim, not a runtime property) is legitimate — confirmed by
  direct source read rather than taken on the coder's word.
- **Invariant 2** ("success line only when both refuse gates pass") —
  cross-checked the real `stop-swarm.sh:84-96` against the property
  runner's oracle (`survivor.argv === null && killRc === 0`) and the
  script's actual branching (survivor refuse exit 1; `kill_rc` refuse
  `exit "$kill_rc"`; success line only past both) — the oracle is faithful.
  9/9 exhaustive combinations (3 survivor shapes × {0,1,7} kill_rc) pass
  against the real script, re-run independently, green (see D1's measured
  evidence above for the exact command/output).
- **Exit-code propagation** (the ticket's own judgment-call #1 in
  `approval_context`) — `stop-swarm.sh:91` does `exit "$kill_rc"`, not a
  generic 1; the property matrix's kill_rc values `{0,1,7}` and the
  acceptance feature's two example rows independently confirmed to pin the
  exact propagated code, not just "non-zero".
- **Dependency-rule gate (BL-259)** — all 6 changed files are under
  `specs/pipeline/` and `swarmforge/scripts/`, none under `extension/src/`;
  `dependency-gate.js` errors immediately (scan root is `extension/`,
  structurally N/A here, same as every other babashka/shell/pipeline-only
  parcel).
- **Co-change coupling (BL-255)** — ran `co-change-report.js` on
  `bl746StopSwarmFixture.js` and `test_lifecycle_script_scope.sh`. All
  reported co-changes are within the same pipeline-steps/test-
  infrastructure domain this parcel already lives in (`index.js`,
  `bl637LifecycleScriptScopeSteps.js`, `BL-872` tempdir-trap-guard
  siblings) — nothing crosses into webview/UI/extension-host code.
- **Wiring** — `specs/pipeline/steps/index.js` registers
  `bl746StopSwarmRealRefuseGatesSteps` correctly (new line added, comma
  fixed on the prior entry, no syntax break).
- **Shell-side cleanup** — `test_lifecycle_script_scope.sh`'s OWN
  `STOP_FIX` fixture (a *different*, bash-native copy of the same
  technique) is properly `register_tmp_dir`'d and explicitly `rm -rf`'d at
  line 216 — the leak is isolated to the JS-side shared fixture lib only,
  not the shell suite.
- Full suite re-run independently: `bash swarmforge/scripts/test/
  test_lifecycle_script_scope.sh` → 15/15 PASS.

## Remediation pointer

Coder: add a `cleanupFixtureRoot(fixture)` export to
`specs/pipeline/steps/lib/bl746StopSwarmFixture.js` (`fs.rmSync(fixture.root,
{recursive: true, force: true})` — the exact shape `bl886SupervisorFixture.js`
already uses), then call it from both existing call sites: once per
iteration in `bl746_stop_swarm_refuse_gate_property_runner.js`'s `runOne`
(after `runOne`'s result is captured, mirroring `bl886`'s own
property-runner call site), and from `bl746StopSwarmRealRefuseGatesSteps.js`'s
terminal `Then` steps before their final assertion (mirroring
`bl887ConsolidateProcessScopePredicateSteps.js`'s own call sites) — every
`Then` step already re-fetches `runStopSwarm(ctx)`'s memoized result, so
cleanup can run once the result is captured and before the assertion
throws. No change needed to `test_lifecycle_script_scope.sh` (already
clean) or to `stop-swarm.sh` itself (unchanged, correctly).

By architect.
