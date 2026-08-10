# BL-789 architect bounce — 2026-08-10

Reviewed commit: 79cc04b29 (coder, "BL-789: adopt the 2026-08-02 Mac
host-switch freshness+bridge hotfix"), received via cleaner merge
6d0a3120f2.

## Verified clean (no defect)

- All 3 declared invariants: real, non-vacuous property-test coverage
  (`extension/test/bl789MacHostSwitchFreshnessBridgeAdoptInvariants.property.test.js`),
  all 3 pass (`npm run test:properties -- bl789`).
- All 4 required_wiring anchors present and correct (SKIP_BABYSITTERD honoured
  in the real checker; installer's crontab line carries `PATH=`; adopt path in
  the real supervisor, gated on BOTH cmdline-identity AND a live health probe,
  never socket-only; acceptance feature exists, 7/7 scenarios pass).
- `swarm_ensure.bb` / `start_ancillary_services.sh` / the checker each read
  `SWARMFORGE_SKIP_BABYSITTERD` independently — reviewed and accepted per the
  ticket's own escape valve ("or state plainly why two are correct"): three
  different language runtimes (bb/bash/POSIX sh), three different lifecycle
  moments: no shared-function refactor is realistic here, and the coder's own
  comment states the reasoning inline.
- Dependency-gate (BL-259 hard gate): PASSED, no forbidden edges.
- Co-change report: only expected sibling coupling (supervisor <-> its lib
  <-> its test runner), nothing new or suspicious.
- Full acceptance feature (`specs/features/BL-789-...feature`): 7/7 pass.
- Extended `test_daemon_log_freshness.sh`: all PASS, including the 4 harden
  cases and the 3 required_wiring greps.
- `front_desk_supervisor_lib_test_runner.bb`: ALL PASS.
- 3 of 4 existing front-desk-supervisor shell tests: PASS. The 4th
  (`test_front_desk_supervisor_tick.sh`) fails on `bl-303 supervisor-recovery`
  timing assertions on this host — confirmed PRE-EXISTING and unrelated by
  running the pre-BL-789 blob (`git show a12b3e3cd:...`) in place: identical
  failures. Not attributed to this ticket.
- docs/index.md links the hotfix how-to (scope item 4); BL-675 how-to
  accurately updated.
- Stryker concurrency question (approval_context): concurrency=1 across all
  3 configs confirmed as the correct steady state for this host, not a
  temporary measure needing an expiry note — consistent with this host's
  independently-observed Stryker dry-run timeout behavior even at
  concurrency=1 under load. No expiry note needed.

## D1 — new detached-daemon spawns bypass the established fixtureReaper
safety net; live orphan confirms it (class: behavior, blame: coder)

Three new call sites spawn REAL, long-running, detached+unref'd processes
and rely ONLY on the last step of their own scenario/property doing cleanup:

- `specs/pipeline/steps/bl789MacHostSwitchFreshnessBridgeAdoptSteps.js`
  scenario 04/05 (`a healthy bridge process is listening...` /
  `an unrelated process is listening...`, lines 309 and 323) — fake bridge
  processes, cleaned up only inside `no second bridge process is spawned` /
  `a bridge process is spawned`, the LAST step of each scenario.
- Same file, scenario 06 (`the handoff daemon begins a cycle that outlasts
  the freshness window`, line 478) — a REAL `handoffd.bb` spawn, cleaned up
  only inside `the daemon is not reported as wedged`, again the last step.
- `extension/test/bl789MacHostSwitchFreshnessBridgeAdoptInvariants.property.test.js`
  invariant 3 (line 238) — another real `handoffd.bb` spawn; cleanup lives in
  a `finally` block, which is a better shape, but the block still only runs
  if the surrounding async function actually unwinds — see below.

If ANY assertion earlier in the same scenario throws (exactly what a real
regression under test SHOULD trigger), or the test process itself is
interrupted/killed/timed out before that point, the spawned process is
never terminated. This is precisely the failure class BL-458 already fixed
for `specs/pipeline/steps/`: see
`specs/pipeline/steps/lib/fixtureReaper.js`'s own header ("four such
mini-swarms survived ~18h and ~1.45 GB after a Jul-15 interrupted run") and
its `track()`/`onAbnormalExit()` API, built for exactly this shape and
already used by sibling front-desk-supervisor spawns in
`specs/pipeline/steps/frontDeskHeadlessLauncherSteps.js`,
`frontDeskSurvivesRebootSteps.js`, `mergedCodeReachesDaemonsSteps.js`, and
others. None of BL-789's three new spawn sites call `track()` or
`onAbnormalExit()`.
`extension/test/` (the property test) has no equivalent registered
safety net at all — `test/helpers/tmpDirSetup.js`'s `afterEach`/`afterAll`
hooks sweep only temp DIRECTORIES (`sweepPendingTmpDirs`/
`sweepSharedTmpDirs`), never spawned processes; no other file under
`extension/test/` spawns a real, long-running daemon this way to have
established a precedent for.

**This is not theoretical.** At review time, a `bb .../handoffd.bb
/var/folders/.../T/bl789-handoffd-3W1mTg` process (PID 89590) was found
still running, started 19:36 (over an hour before this review began), with
no stop-marker ever written and a 1.7 MB and growing `handoffd.log` — an
orphan from an earlier interrupted run of this exact new property test (the
`bl789-handoffd-` prefix is unique to
`extension/test/bl789MacHostSwitchFreshnessBridgeAdoptInvariants.property.test.js`'s
`makeRoot()`/spawn in invariant 3). Confirmed NOT attributable to this
review's own (fully-passing) acceptance run: a before/after process census
around that run showed no new `bl789`-tagged or `pickIsolatedPort()`-ranged
(20000-40000) process left behind — cleanup works fine on the happy path,
exactly as expected; it is the failure/interruption path that has no net.
The orphan was terminated and its stale fixture directory removed as part
of this review (SIGTERM, confirmed dead, `rm -rf` on the `/var/folders`
tmp path only — nothing under version control was touched).

**Remediation**: wire all three spawn sites through
`specs/pipeline/steps/lib/fixtureReaper.js`'s `track()` (bridge/handoffd
roots with a pidfile/status.json shape) or `onAbnormalExit()` (a
custom-shape kill, e.g. handoffd's own pidfile under
`.swarmforge/daemon/handoffd.pid` plus the `stop` marker convention scenario
06 already uses on its happy path) — same pattern as
`frontDeskHeadlessLauncherSteps.js`. The property test
(`extension/test/`) has no existing equivalent to reuse; either give it its
own minimal `process.on('exit'/'SIGINT'/'SIGTERM', ...)` registration
mirroring `fixtureReaper.js`'s `onAbnormalExit`, or (simpler, and consistent
with `test/helpers/fakeAgentTree.js`'s process-GROUP kill convention) spawn
without `detached:true`/`unref()` so the child dies with its Vitest worker.
