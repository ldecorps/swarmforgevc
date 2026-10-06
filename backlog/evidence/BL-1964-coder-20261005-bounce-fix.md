# BL-1964 — coder pass, 2026-10-05 (bounce fix)

QA bounce (backlog/evidence/BL-1964-QA-20261005.md, commit 1e16e87207):
D1 (behavior) + D2 (acceptance), both coder-owned. Both fixed.

## D1 — wake-session read the tracked conf, never the effective (launched) one
- `handoff_lib.bb` `wake-session`: the deterministic-coordinator flag is now
  read via `backlog-depth-lib/conf-file-path (target-root)` (already loaded
  in this file) instead of a hard-coded `swarmforge/swarmforge.conf` path.
  `conf-file-path` resolves the EFFECTIVE conf a `--pack` launch persisted
  into `.swarmforge/swarm-identity`, falling back to the tracked default
  only when no swarm-identity override exists — the exact reader
  `handoffd.bb`'s `coordinator-mail-sweep!` and the open-slot sweep already
  use for this same flag (IO-near code calls the module that owns the
  answer, BL-1811 — never a second reader). `rotation-router-pack?` beside
  it was already correct (it already resolves via swarm-identity through
  `mono-router-lib/resolve-rotation-router-mode?`); only the deterministic
  read was wrong.
- Non-vacuous: temporarily reverted to the pre-fix hard-coded read and
  re-ran the acceptance feature — scenario 01 failed exactly as QA's D1
  described (`expected no session (nil) ... got: swarmforge-coordinator`).
  Restored and re-verified green.

## D2 — the step handler bypassed wake-session, restating its own conf read
- `bl1964CoordinatorResolvesToNoWakeSessionSteps.js` `runResolveProbe` now
  calls the REAL `handoff-lib/wake-session` (via `set-project-root!` on the
  fixture) instead of re-deriving the deterministic flag itself and calling
  `resolve-wake-session` directly — the exact gap D2 named ("wake-session
  itself is never invoked"). The fixture now writes the deterministic/
  router lines into an effective pack conf
  (`swarmforge/packs/det.conf`, named via `.swarmforge/swarm-identity`'s
  `active_backlog_max_depth_conf_path`), with the tracked
  `swarmforge/swarmforge.conf` left declaring neither directive — proving
  D1's fix is what the acceptance run actually exercises, not a
  coincidence of both reading the same file.
- Scenario 02's existing shortcut (asserting `swarmforge-coordinator`
  without a session-exists? check, since standing up a REAL tmux session
  on the fixture's socket is unneeded weight for a branch
  `resolve-wake-session`'s first cond clause already proves) was left
  unchanged — QA's inventory (Article 4.4, complete pass) did not name it
  a defect, and this bounce fixes exactly what it found, not more.

## Run
- `node specs/pipeline/cli.js specs/features/BL-1964-a-deterministic-router-packs-coordinator-resolves-to-no-wake-session.feature`:
  2 of 2 ok (both before-fix-fails-after-fix-passes, confirmed by the
  non-vacuity check above).
- `bb swarmforge/scripts/test/handoff_wake_session_test_runner.bb`:
  ALL TESTS PASSED.
- `bb -e '(load-file "swarmforge/scripts/handoff_lib.bb")'`: loads clean.

## Unowned red found during regression sweep (reported, not fixed here)
- `bash swarmforge/scripts/test/test_handoffd_bl812_cwd_invariant_root_resolution.sh`
  fails at its own check 02 ("wake session for architect expected
  swarmforge-coder (remap), got 'swarmforge-architect'") — reproduced
  identically against `git show HEAD:swarmforge/scripts/handoff_lib.bb`
  (pre-bounce-fix), so this is a pre-existing red on `main`, not caused by
  this parcel. `backlog/standing-reds.tsv` and `backlog/{active,paused,done}`
  name no owning ticket. Sent `unowned-red` note (priority 00) to
  specifier+coordinator; continuing this parcel per the standing-red rule.
- Spot-checked siblings for regression from this fix:
  `test_handoffd_wake_no_session_standing_pack.sh` (ALL SCENARIOS PASSED),
  `test_babysitter_check.sh` (ALL PASS), `mono_router_lib_test_runner.bb`
  (ok) — none touch the deterministic-coordinator flag this bounce changed.

By coder.
