# BL-1333 hardener pass — 2026-09-03

Merged architect commit `de6eae7cf7` (clean sweep, no defect) onto this
worktree — clean merge, no conflicts.

This is a BL-848 review-only stamp-off of already-landed commits
`f57795b6d2`/`d5739d84cc`. Confirmed `backlog/hotfix-ledger.yaml` is
still untouched (both rows `state: stamp-open`, `human_decision`/
`decided_at` null) — this pass, like the coder/cleaner/architect passes
before it, reviews and never certifies/waives.

## required_wiring re-confirmed live
Re-grepped all four anchors (`master-main-reconcile-redundant-paths!`,
`master-main-reconcile-drop-redundant-dirty-paths!`, `blocking-overlap`,
`bl1333SwarmStampReconcileRedundantOverlapSteps`) — same counts as the
architect's evidence.

## Real defect found and fixed: socket-fixture-root guard violation
`extension/test/socketFixtureShortRootGuard.test.js` — a standing
whole-tree guard the parcel's `specs/pipeline/steps/` change is subject
to (per this session's own standing-guard rule) — flagged
`specs/pipeline/steps/lib/bl1333ReconcileStampFixture.js` as a NEW
violation, distinct from the two pre-existing already-ticketed ones
(`bl1112StandingUnitRedsSteps.js`, `bl691AmbulanceWorkflowGapsSteps.js`,
BL-1290). Neither the coder, cleaner, nor architect evidence mentions
running the whole-tree guards for this ticket.

Cause: `mkroot()` built every fixture root (`remote`, `root`, `clone`)
under `os.tmpdir()` via `fs.mkdtempSync`, and `root` writes a real
`.swarmforge/tmux-socket` pointer file
(`fake.sock` under `root`) — exactly the shape BL-948's guard exists to
catch: on macOS `os.tmpdir()` resolves under the long
`/var/folders/<hash>/<hash>/T/` path, and a control-socket path built
under it overruns `swarm_socket_lib.bb`'s 100-char guard, so the
scenario would die on that refusal instead of on what it actually
asserts.

Fix: `mkroot()` now calls the shared `mkSocketFixtureRoot` helper
(`lib/socketFixtureRoot.js`, BL-948's own remedy — rooted at `/tmp`,
tracked and reaped on process exit as a backstop), and
`sweepStaleFixtures()`/`removeFixture()` updated to match (short base,
`releaseSocketFixtureRoot` on explicit removal). Removed the now-unused
`os` import and the file's own `FIXTURE_PREFIX`-under-`os.tmpdir()`
scan.

Re-verified after the fix:
- `npx vitest run test/socketFixtureShortRootGuard.test.js` — the file
  no longer appears; only the 2 pre-existing BL-1290 violations remain.
- `node specs/pipeline/cli.js
  specs/features/BL-1333-swarm-stamp-reconcile-redundant-overlap-f57795b6d2.feature`
  — still 8/8 pass, unchanged behavior.
- `npx vitest run --config vitest.properties.config.mjs
  bl1333StampOffInvariants` — still 3/3 pass, unchanged.
- No fixture directories leaked under `/tmp` after either run (checked
  before and after both).

## BL-113 Gherkin soft mutation
One `Scenario Outline:` (02, the matches/differs axis). Ran on the
detached `swarmforge/scripts/detach_job.sh` path (real-git fixture
scenarios are slow, ~10-20s each): **4/4 killed, 0 survived, 0 errors**.

## Property test
`bl1333StampOffInvariants` — re-run twice (matches the architect's
"real-fixture properties are slow, two runs proportionate" posture,
since reach floors are construction-guaranteed via the enclosing
`Object.entries(SHAPES)` loop, not drawn): 3/3 both times.

## Other checks (re-run independently)
- `node out/tools/dependency-gate.js` — PASSED, no forbidden edges.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.

## Verdict
One real gap found and fixed (socket-fixture-root portability defect in
the review harness's own fixture). Everything else confirms the
architect's clean sweep. Forwarding to documenter.
