# BL-1342 hardener pass — 2026-09-03

Merged architect commit `dd2d5de818` (clean sweep, no defect) onto this
worktree — clean merge, no conflicts.

This is a BL-848 review-only stamp-off of already-landed commit
`27d6ab8630` (same shape as this session's BL-1333). Confirmed
`backlog/hotfix-ledger.yaml`'s `27d6ab8630` row is still `state:
stamp-open` — untouched.

## required_wiring re-confirmed live
Re-grepped `handoff_lib.bb::read-envelope-if-present`,
`handoffd.bb::outbox-parcel-unreadable`,
`handoffd_supervisor.bb::daemon-age-ms`, and
`bl1342SwarmStampHandoffdCrashloopHotfixSteps` — all present, matching
the architect's evidence.

## Real defect found and fixed: same socket-fixture-root guard violation as BL-1333
Learned from this session's BL-1333 pass to check the standing whole-tree
guards' actual violation LISTS, not just grep the ticket id. Found
`specs/pipeline/steps/lib/bl1342CrashloopStampFixture.js` newly flagged by
`socketFixtureShortRootGuard.test.js` — the same pattern: `makeFixture()`
built its root under `os.tmpdir()` and wrote a real
`.swarmforge/tmux-socket` pointer file (`fake.sock`), and a second,
unrelated root in `callSupervisor()` also used `os.tmpdir()` (pulled into
scope by the file-wide socket co-occurrence the guard scans for). Neither
the coder's self-audit, the cleaner, nor the architect ran this guard for
this ticket either — same miss as BL-1333, now the second occurrence this
session.

Fix: both `mkdtempSync(os.tmpdir(), ...)` call sites switched to the
shared `mkSocketFixtureRoot` (BL-948), `sweepStaleFixtures()` switched to
scan the short base, and `removeFixture()`/`callSupervisor()`'s cleanup
updated to call `releaseSocketFixtureRoot`. Removed the now-unused `os`
import.

Re-verified after the fix:
- `npx vitest run test/socketFixtureShortRootGuard.test.js` — the file no
  longer appears; only the 2 pre-existing BL-1290 violations remain.
- `node specs/pipeline/cli.js
  specs/features/BL-1342-swarm-stamp-handoffd-crashloop-hotfix-27d6ab8630.feature`
  — still 9/9 pass, unchanged behavior.
- `npx vitest run --config vitest.properties.config.mjs
  bl1342CrashloopStampInvariants` — 3 consecutive runs, 3/3 each,
  unchanged.
- `test_handoffd_outbox_vanished_parcel_wiring.sh` — 4/4 PASS.
- `handoffd_supervisor_startup_grace_test_runner.bb` — ALL TESTS PASS.
- `bl977_supervisor_progress_property_runner.bb` — 200 draws, ALL
  PROPERTIES HOLD.
- No fixture directories leaked under `/tmp` after any of the above runs.

## BL-113 Gherkin soft mutation
One `Scenario Outline:`. Ran fresh (`mktemp -d`, deleted after): **6/6
killed, 0 survived, 0 errors**.

## Standing whole-tree guards (re-checked after the fix)
Same 3 pre-existing, already-ticketed failures as this session's earlier
passes (BL-1289/1290/1291) — confirmed by reading each guard's violation
list, none naming a file this ticket touches.

## Other checks
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.

## Verdict
One real gap found and fixed (the same socket-fixture-root portability
defect BL-1333 had, in this ticket's own review harness). Everything
else confirms the architect's clean sweep. Forwarding to documenter.
