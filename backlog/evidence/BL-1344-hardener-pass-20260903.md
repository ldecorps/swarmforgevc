# BL-1344 hardener pass — 2026-09-03

Merged architect commit `700d1fff17` (clean sweep, no defect) onto this
worktree (one trivial additive `require(...)`-list conflict in
`specs/pipeline/steps/index.js`, resolved keeping both).

## required_wiring re-confirmed live
`babysitter_check.bb::babysitter-waive-lib` — loaded AND consulted at
the live nudge decision (`read-waive-store`/`partition-findings` feed
`decide-nudges`, not merely loaded per BL-1235). `bl1344BabysitterFindingWaiveSteps`
registered.

## Real defect found and fixed: socket-fixture-root guard violation (4th occurrence this session)
`specs/pipeline/steps/lib/bl1344WaiveFixture.js` was flagged by
`socketFixtureShortRootGuard.test.js` — this file doesn't itself write a
`.swarmforge/tmux-socket` file, but the fixture builds a real git repo
under `os.tmpdir()` and the guard scans for the file-wide co-occurrence
of a long-base `mkdtemp` with any control-socket reference elsewhere in
the same directory family (per its own smoke-test description); the
fix is identical regardless: switch the root builder off `os.tmpdir()`.
Same class as BL-1333/BL-1342/BL-1346 earlier this session — fourth
occurrence, though this is the first NON-stamp-off ticket to carry it,
so my earlier read (concentrated in the BL-848 review family) was too
narrow: any NEW fixture that builds a real project root via
`fs.mkdtempSync(os.tmpdir(), ...)` is at risk, not just stamp-off
harnesses.

Fix: identical remedy — `mkroot` switched to `mkSocketFixtureRoot`,
`sweepStaleFixtures()` switched to the short base, `removeFixture()`
calls `releaseSocketFixtureRoot`. Removed the unused `os` import.

Re-verified after the fix:
- `npx vitest run test/socketFixtureShortRootGuard.test.js` — the file
  no longer appears; only the 2 pre-existing BL-1290 violations remain.
- `node specs/pipeline/cli.js
  specs/features/BL-1344-an-investigated-finding-can-be-waived.feature`
  — still 7/7 pass, unchanged behavior.
- `npx vitest run --config vitest.properties.config.mjs
  bl1344WaiveInvariants` — 3 consecutive runs, 3/3 each.
- No fixture directories leaked under `/tmp` after any run.

## Re-run independently
- `bb swarmforge/scripts/test/bl1344_waive_lib_test_runner.bb` — ALL
  PASS.
- `bash swarmforge/scripts/test/test_babysitter_check.sh` — ALL PASS
  (17 checks).
- `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb` —
  ok.

## Scope reading confirmed
Re-read the architect's finding that the waive silences only the
coordinator nudge, not the operator's `BABYSITTER_ESCALATION` path
(`decide-escalations` still called with unfiltered `findings`). Matches
the ticket's own `invariants`/description, which speak only of "nudge".
Not a defect; not this parcel's to generalize.

## BL-113 Gherkin soft mutation
One `Scenario Outline:`. Ran fresh (`mktemp -d`, deleted after): **2/2
killed, 0 survived, 0 errors**.

## Standing whole-tree guards
Same 3 pre-existing, already-ticketed failures as this session's
earlier passes (BL-1289/1290/1291) — confirmed by reading each guard's
violation list, none naming a file this ticket touches (post-fix).

## Other checks
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.

## Verdict
One real gap found and fixed (fourth occurrence this session of the
socket-fixture-root defect, this time in a non-stamp-off ticket).
Everything else confirms the architect's clean sweep. Forwarding to
documenter.
