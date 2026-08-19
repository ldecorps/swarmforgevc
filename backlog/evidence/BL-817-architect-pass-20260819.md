# BL-817 architect pass — 2026-08-19

## Reviewed commits
`f11454ac0` ("BL-817: adopt the shared fixture reaper for tmux-server
acceptance fixtures"), `679ce77ee` ("... (continued)" — the real content,
after the first commit's `git add` aborted on a stale pathspec), and
`797f89f71` ("BL-817: record a surfaced-not-fixed defect from regression
testing"), all By coder. Forwarded unchanged by cleaner (`92c85ee228` is a
pure merge commit — no cleaner-authored diff on top, confirmed via
`git diff 797f89f71 92c85ee228 --stat`, which shows only unrelated
sibling-ticket evidence files pulled in by merging other branches into
cleaner, nothing touching BL-817's own files).

Full parcel diff (`git diff f11454ac0^ 797f89f71`) touches 18 files: the
ticket YAML, a surfaced-defect evidence file, 2 new extension/test/ files,
the promoted `.feature` (rename), 6 step-handler files (5 originally named
plus `bl807BabysitterStuckInProcessOwnerLivenessSteps.js`, a genuine
seventh offender found and fixed in this same parcel), a new
`bl817FixtureTmuxServersReapedSteps.js`, `index.js`'s registration,
`fixtureReaper.js`'s invariant-2 guard, a new
`fixtureReaperTmuxOnlyHarness.js`, a new `tmuxReaperGuard.js`, a
`fixtureReaper.test.js` addition, and `hardender.prompt`'s stopgap-bullet
removal.

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate**: only 2 files in this parcel live under
   `extension/` (`extension/test/fixtureReaperLiveSocketGuard.property.test.js`,
   `extension/test/tmuxReaperGuard.test.js`) — both under `test/`, not
   `src/`or `media/`, so no forbidden-edge `from` pattern in
   `.dependency-cruiser.cjs` applies to them. Ran per-parcel mode against
   both anyway (`node out/tools/dependency-gate.js test/fixtureReaperLiveSocketGuard.property.test.js test/tmuxReaperGuard.test.js`
   from `extension/`): **PASSED, no forbidden edges**. The other 16 changed
   files live under `specs/pipeline/`, `swarmforge/`, and `backlog/` —
   entirely outside this gate's `src`/`media` scope (SwarmForge's own
   acceptance harness, not the VS Code extension host/webview) — nothing
   for the gate to check there, consistent with BL-937/BL-938 precedent for
   non-`extension/` parcels.
2. **Co-change report**: ran against all 14 code/test files changed. Only
   one pair flagged: `alwaysOnOperatorPresenceSteps.js` ↔
   `controlLossIsNotAgentDeathSteps.js`, 4 co-changes (at the suspected-
   coupling threshold). Both are sibling step-handler files in the same
   acceptance domain (operator presence / control loss) that have
   historically been touched together across unrelated tickets — this
   parcel's own identical `track()` adoption in both is the same shape,
   not new structural coupling. No action warranted.
3. **Invariant 1** ("no tmux server outlives its run, whatever ends the
   scenario"): stated non-encodable as a property (quantifies over real
   OS process/signal lifecycle, not a pure function's input space) —
   accepted, matches this codebase's established testability boundary.
   Verified instead via a real executable test: the new
   `fixtureReaperTmuxOnlyHarness.js` (a standalone process starting a real
   tmux server, calling `track()`, then ending 3 real ways) driving
   scenario 01's 4 Examples rows (terminal / thrown assertion / mutant
   failing early / SIGTERM). Read the harness and confirmed "thrown
   assertion" and "mutant failing early" correctly map to the SAME
   underlying mechanism (an uncaught exception firing Node's `exit`
   handler) — not a padding row, a correct recognition that both are
   indistinguishable at the process level, which is what `track()`
   actually guards against.
4. **Invariant 2** ("reaping is decided by socket path alone, never
   session name"): a genuine, ticket-authored property test
   (`extension/test/fixtureReaperLiveSocketGuard.property.test.js`, 3
   properties, 200/200/100 runs). **Independently re-verified non-vacuity
   myself, not just trusted from the commit message**: edited
   `isLiveRepoSwarmforgeSocket` to `return false` (the pre-fix behaviour),
   re-ran the property suite — failed immediately on the first generated
   case (`expected /tmp/sfvc-fixture-abc123/.swarmforge/tmux/a.sock to be
   protected`). Restored the file via the untouched backup and confirmed
   `git status` clean and the suite green again before proceeding.
5. **Invariant 3** ("reaping is idempotent — an already-exited fixture
   reaps cleanly, never as an error"): the commit message under-sells its
   own coverage here — it cites only the pre-existing
   `specs/pipeline/test/fixtureReaper.test.js` example test, but this
   ticket ALSO added a dedicated acceptance scenario for it (scenario 03,
   "a fixture whose server already exited reaps without error") in the new
   `.feature` file, driven by a real tmux server killed before `reap()`
   runs. Ran it live — passes. Same non-encodability class as invariant 1
   (real process/OS state, not a pure-function input space); the coverage
   is real and ticket-authored even though the commit message didn't
   explicitly restate the non-encodability reasoning for this specific
   invariant. Not a send-back — the substance is there, only the prose
   explanation was implicit.
6. **Site-completeness sweep**: read every diff to the 6 adopted step files
   (5 originally named + the genuine 7th, `bl807...`) and confirmed
   `track(root)` is called BEFORE the file's own tmux-server spawn point in
   every case (traced the actual call graph for the two non-obvious ones —
   `alwaysOnOperatorPresenceSteps.js`'s `mkRuntimeFixture()` doesn't itself
   spawn tmux, and `bl807...`'s `track()` runs inside `ensureState()`,
   called from the Background step, always before `startTmuxSession()` is
   reachable from any later step). Independently verified
   `tmuxDoubleAnswersInProcessSteps.js` (the "sixth name the hardener's own
   count implied") truly needs no adoption — grepped it directly: zero
   `new-session` literal, `child_process.spawnSync` is patched in-process,
   and `installFakeTmux` (read `extension/test/helpers/fakeTmux.js`)
   PATH-shadows a fake script rather than invoking the real `tmux` binary.
   Confirmed, not just trusted.
7. **Gate itself (scenario 04 / `tmuxReaperGuard.js`)**: ran
   `scanForTmuxReaperViolations('./specs/pipeline/steps')` directly against
   the real directory — **0 violations**, confirming the codebase is
   actually clean under the new gate, not just in the gate's own test
   fixtures.
8. **Ran the new acceptance feature end to end**:
   `specs/pipeline/scripts/run_acceptance.sh
   specs/features/BL-817-fixture-tmux-servers-reaped-on-abnormal-scenario-end.feature`
   — **9/9 PASS** (4 scenario-01 endings, 3 scenario-02 socket-location
   cases, scenario 03, scenario 04).
9. **Live-reproduction check beyond the ticket's own feature**: ran the
   REAL `specs/features/BL-647-rotation-router-liveness.feature` (one of
   the six adopted files, currently 7/7 failing for the unrelated,
   already-surfaced D1 reason — missing `mono_router_lib.bb` in the
   fixture dependency list) and watched `pgrep`/`ps` for fixture tmux
   servers before and after: **zero new leaked processes**, despite every
   scenario failing early via the D1 defect — direct proof invariant 1
   holds under a REAL, currently-reproducible failure mode, not just the
   synthetic harness.
   - Found 7 PRE-EXISTING orphaned `bl647.sock` tmux servers already alive
     on the host (PPID 1, started 08:53:41-47, ~30min before this pass).
     Investigated rather than assumed: my own live re-run of the identical
     feature at 09:24 produced zero new leaks under the same D1-driven
     failure path, so the fixed code is not reproducibly leaky. The 08:53
     cluster most likely predates this fix reaching a clean state on this
     shared, concurrently-running live-swarm host (SIGKILL/OOM survival
     was never a claimed invariant — `process.on('exit')` cannot intercept
     SIGKILL, by OS design, in any language). Not this parcel's defect;
     left untouched (did not create these processes, so did not remove
     them — no cleanup of unowned state).
10. **Property Testing pass** (undeclared properties beyond the ticket's
    own invariants): `tmuxReaperGuard.js`'s `findTmuxReaperViolation` is a
    pure, touched, testable function, but its coverage is already solid
    via `extension/test/tmuxReaperGuard.test.js`'s 7 concrete examples,
    explicitly chosen against real false-positive candidates grepped from
    this repo (bl696/bl763/bl766's own `/lets-talk/new-session` HTTP
    paths, bl849/bl879's simulated ps-output). A text-pattern classifier
    over source code doesn't have a clean round-trip/idempotence/ordering
    shape a fast-check property would usefully encode beyond what those
    targeted examples already prove. No new property test added; none
    warranted.
11. **Module boundaries / two-layer architecture**: not implicated — no
    extension host/webview code touched (the two `extension/test/` files
    are test-only), no I/O ownership changed, no new process spawned
    bypassing tmux (the reaper kills processes tmux itself started), no
    secrets, no webview storage.
12. **Correctness read**: no defect spotted beyond the invariants above.
    The pre-existing, separately-surfaced D1 defect
    (`backlog/evidence/BL-817-surfaced-defect-not-fixed-20260819.md`,
    `operatorRuntimeBbFixtureFiles.js` missing `mono_router_lib.bb`) is
    correctly out of this parcel's own scope (verified myself per item 9
    above — the failure occurs strictly after `track()` already ran) and
    was already raised via `note` to specifier/coordinator per the
    BL-937/BL-938 precedent; already tracked as BL-944 per this session's
    own coordinator/specifier bookkeeping.

## Verdict
No architecture violation, no invariant violation, no correctness defect.
All three declared invariants hold, independently re-verified (including
a live reproduction against a real, currently-failing feature file beyond
the ticket's own new acceptance coverage, and a hand-verified non-vacuity
break/restore of the invariant-2 property test). Forwarding to hardener.

By architect.
