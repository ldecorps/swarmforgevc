# BL-817 — one real defect surfaced while regression-testing, not fixed here (2026-08-19)

BL-817's own scope is fixture-tmux-server reaping; this evidence file
records a completely separate, pre-existing defect stumbled into while
regression-testing the three feature files whose step handlers BL-817
touches, same disposition as BL-937's D1/D2 and BL-938's own D1.

## D1 — operatorRuntimeBbFixtureFiles.js is missing mono_router_lib.bb, breaking every acceptance scenario that ticks operator_runtime.bb

**Reproduced**: `node specs/pipeline/cli.js specs/features/BL-647-rotation-router-liveness.feature`
(and BL-359-always-on-operator-presence.feature, BL-368-control-loss-is-not-agent-death.feature),
all fail identically:

```
Type:     java.io.FileNotFoundException
Message:  <fixtureRoot>/swarmforge/scripts/mono_router_lib.bb (No such file or directory)
Location: <fixtureRoot>/swarmforge/scripts/handoff_lib.bb:30:1
  30: (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "mono_router_lib.bb")))
```

Counts: BL-647 7/7 scenarios fail. BL-368 4/4 fail. BL-359 5/7 pass, the
2 that fail are exactly the 2 whose steps call `tick()` against the real
`operator_runtime.bb` subprocess (the other 5 never reach that path).

**Root cause**: `specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js`
exports `OPERATOR_RUNTIME_BB_FILES`, the fixed list of `.bb` files each of
these three step handlers copies into its own disposable fixture root
before shelling out to a real `bb operator_runtime.bb ... --tick-once`
subprocess. `handoff_lib.bb` is in that list and IS copied; `handoff_lib.bb`
line 30 `load-file`s `mono_router_lib.bb` (a dependency BL-931 added when it
landed earlier today, 2026-08-19, per `handoff_lib.bb`'s own
`rotation-router-pack?` calling `mono-router-lib/resolve-rotation-router-mode?`)
- but `mono_router_lib.bb` was never added to `OPERATOR_RUNTIME_BB_FILES`,
so it is never copied into the fixture, and every fixture-rooted `bb`
subprocess that loads `handoff_lib.bb` now dies on a missing file before
reaching whatever behaviour the scenario actually wants to prove.

**Why not fixed here**: `operatorRuntimeBbFixtureFiles.js` is a shared
fixture-dependency list unrelated to BL-817's own invariants (fixture tmux-
server reaping only) - BL-817's required_wiring and invariant 1 pin its
diff to the tmux-reaper adoption, not to fixture dependency lists. This is
also plainly a same-day side effect of BL-931 (which this session's coder
already fixed the aged-note-wiring-fixture half of, as BL-938), not
anything BL-817 introduced.

**Verified BL-817's own changes are not the cause**: the failure occurs
INSIDE the `bb operator_runtime.bb ... --tick-once` subprocess, at
`handoff_lib.bb` load time - strictly AFTER each affected file's `track()`
call (added by this ticket) already ran successfully in the parent JS
process, during fixture setup, well before `tick()` is ever invoked.
`OPERATOR_RUNTIME_BB_FILES` itself is untouched in this parcel (`git diff`
confirms). The two sibling feature files this ticket also touched
(BL-804-babysitter-mono-router-topology-awareness.feature,
BL-807-babysitter-stuck-in-process-warn-ignores-owner-liveness.feature) use
a completely different fixture mechanism (`babysitter_check.sh`, no
`operator_runtime.bb`, no `operatorRuntimeBbFixtureFiles.js` dependency at
all) and both ran clean (11/11 and 4/4) after their own `track()` adoption,
which is the actual regression evidence for BL-817's fix shape being
correct.

## Disposition

Raised via a priority-00 `note` to the specifier and coordinator alongside
this parcel's `git_handoff`, per the BL-937/BL-938 precedent: a real,
previously-unreachable-today defect surfaced while verifying an unrelated
fix, recorded with evidence rather than silently patched or silently
ignored. Does not block BL-817 itself: the tmux-reaper adoption in all six
files (five originally named plus bl807BabysitterStuckInProcessOwnerLivenessSteps.js,
a genuine seventh offender found and fixed in this same parcel - see the
commit message) is verified correct via its own new acceptance feature
(BL-817-fixture-tmux-servers-reaped-on-abnormal-scenario-end.feature, 9/9
passing, exercising a real tmux server under three real termination modes
plus the real socket-path guard), the standing unit/property-test coverage
(specs/pipeline/test/fixtureReaper.test.js, extension/test/tmuxReaperGuard.test.js,
extension/test/fixtureReaperLiveSocketGuard.property.test.js, all green),
and direct regression runs of the two sibling features unaffected by D1.
