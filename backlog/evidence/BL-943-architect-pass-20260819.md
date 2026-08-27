# BL-943 architect pass — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner c878dfe089` — an
empty-diff merge, since the content had already reached my worktree via
BL-945's bounce-fix ancestry chain. Reviewed the actual implementation
commit `c1c6163f0` ("BL-943: fixture cleanup never decides a daemon
wiring test's verdict", By coder).

Files touched (`git show --stat c1c6163f0`): all six named daemon-fixture
wiring scripts (`test_handoffd_aged_note_rotate_wiring.sh`,
`_ambulance_wiring.sh`, `_rule_proposal_rotate_wiring.sh`,
`_wake_attribution_wiring.sh`, `_priority_rotate_wiring.sh`,
`_starve_rotate_wiring.sh`), the new acceptance step handler
(`bl943FixtureCleanupVerdictSteps.js`), the coder-authored property test
(`bl943_cleanup_wrapper_property_test.sh`), and `index.js`'s registry
line.

## Checks run (complete inventory, not first-failure-stop)

1. **Scope: all six scripts, not fewer** — confirmed via `git show --stat`.
2. **Fix mechanism independently verified, not just read** — wrote a
   standalone reproduction of the core bash claim in the commit message
   (a failing command as an EXIT trap's own final statement silently
   overrides the ORIGINAL triggering exit code): confirmed a broken
   version (bare failing command as the trap's last statement) turns
   `exit 7` into a reported `exit 1`; confirmed the landed shape (`local
   exit_code=$?` captured first, guard the fallible `rm -rf` inside an
   `if`, explicit `return "$exit_code"` last) correctly preserves `exit 7`
   even when the guarded command also fails. This is the mechanism behind
   both declared invariants.
3. **All six scripts run directly, live, on this real (busy) host** — not
   simulated. All six exited 0 with their final `ALL PASS` line. Two of
   the six (`aged_note_rotate` and `ambulance`) hit the ACTUAL flake
   organically under the swarm's own real concurrent load (a genuine
   `rm -rf` failure, not the stub-rm injection) and correctly printed
   `WARN: cleanup could not remove fixture root: <path>` on stderr while
   still completing with `ALL PASS` — stronger evidence than the
   stub-injected case alone, since it is the real-world failure mode this
   ticket exists to fix, caught happening for real during this review.
4. **Coder-authored property test** (`bl943_cleanup_wrapper_property_test.sh`,
   per coder.prompt's Invariants section): 320/320 trials pass. Read
   directly to confirm it exercises the identical wrapper shape (capture
   entry code, guard, warn, explicit return) parameterized over
   (entry-code, rm-outcome) rather than a divergent reimplementation.
   Non-vacuity already documented and checked by hand by the coder
   (reverting to the bare bug shape fails on the first rm-fails trial);
   not independently re-broken by me here, since I already independently
   validated the same core bash mechanism directly in item 2 above.
5. **Acceptance feature**: all 9 scenarios pass (ran the real feature file
   end to end — this took ~4.3 minutes against real daemon fixtures, run
   in the background and confirmed via Monitor rather than truncated).
6. **`chmod` usage audited, not just grepped for absence** — two
   `fs.chmodSync` call sites exist in the new step handler, both making a
   NEWLY-WRITTEN script executable (`0o755` on a stub `rm` and on an
   injected-failure copy of a real script) — not chmod-based failure
   simulation of the banned kind (permission-bit tampering on a fixture
   directory to force `rm -rf` to fail). The actual failure injection is
   the stub-`rm`-on-`PATH` env seam the ticket's own "how" section names
   as the correct idiom. Confirmed compliant, not merely absent-by-grep.
7. **required_wiring**: `bl943FixtureCleanupVerdictSteps` confirmed
   present in `specs/pipeline/steps/index.js`'s `DOMAINS` array.
8. **Dependency-rule gate (BL-259 hard gate)**: PASSED, no forbidden edges
   (ran per-parcel against the one JS file in the diff).
9. **Co-change report (BL-255)**: SUSPECTED COUPLING hits exist for
   `test_handoffd_ambulance_wiring.sh` and two others against
   `index.js`/`handoff_lib.bb`/ambulance- and telegram-bridge-related
   files — read directly and confirmed this is PRE-EXISTING historical
   coupling from each script's own original feature domain (ambulance
   mode, priority rotation, starve rotation), not new coupling introduced
   by this parcel's cleanup-wrapper fix, which touches only each script's
   own `cleanup_*` functions.
10. **Fixture discipline**: the step handler tracks every `mkTmp()` root
    AND every written scratch file in `afterEach` (`trackedRoots` +
    `trackedFiles`). No leaked processes found after the six live runs
    (`ps aux | grep "bb handoffd"` clean).
11. **Module boundaries**: not implicated — no `extension/src/` file, no
    secrets, no webview storage, no process spawned bypassing tmux (this
    is the daemon's own wiring-test fixture layer).
12. **Out-of-scope items respected**: no shared-helper extraction across
    the six scripts (confirmed each still has its own `make_fake_tmux`
    etc.), no rewrite of BL-938's `PASS:`/`FAIL:`-text acceptance
    accommodation, no attempt to fix the `MODULE_NOT_FOUND` sweep-
    subprocess noise.

## Verdict

No architecture violation, no correctness defect found. Both declared
invariants independently re-verified — including by writing my own
standalone reproduction of the underlying bash trap-exit-code mechanism,
and by observing the fix correctly handle two REAL, organically-occurring
cleanup failures live on this host during review, not only the simulated
case. Forwarding to hardener.

By architect.
