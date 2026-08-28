# BL-1196 hardener pass 2 (amendment) — 2026-08-28

Merged architect handoff `7ee1839613` (approval hold cleared, no technical
defect — the specifier's own review had already confirmed the amendment
clean; only `human_approval` was blocking). No conflicts. This is a
follow-on to my own earlier BL-1196 pass this session
(`BL-1196-hardener-pass-20260828.md`): a second incident on the same day
widened the stripped-var set to include `GIT_INDEX_FILE` and added a
second enforcement site inside `check_property_suite_drift.sh` itself
(the vitest setupFile fix cannot reach shell fixtures the property suite
shells out to).

## Notable connection to this session's own earlier incident

Hardening this amendment identified the exact source of the 1000+-process
"rogue-fixture.sh" storm reported earlier today (see
`hardener-noticed-coder-process-explosion-20260828.md`, now updated):
the new acceptance scenario 04
(`bl1196GitEnvGuardStripSteps.js`, "hook-environment-does-not-reach-
fixture-writes-04") builds a fixture at `bl1196-hook-main-<hash>/
rogue-fixture.sh` — an exact match. Very likely the coder was running a
heavy repeated-verification pass over this exact scenario while landing
this same amendment, not an unbounded-spawn defect. Recorded the
connection in that evidence file so it isn't re-investigated as a
separate incident.

## Hand-verified, both new enforcement points

1. `gitEnvGuard.js`'s new `delete process.env.GIT_INDEX_FILE;` line —
   commented out in the compiled/source file, re-ran
   `vitest run test/gitEnvGuard.test.js`: 1/5 fails immediately (the new
   scenario 03 test), 4/5 still pass. Restored; 5/5 green again.
2. `check_property_suite_drift.sh`'s new `unset -v GIT_DIR GIT_WORK_TREE
   GIT_INDEX_FILE` line (the second enforcement site) — commented out and
   re-ran the BL-1196 acceptance feature's scenario 04 (the real
   worktree+hook+fixture end-to-end test). Result: the run that completes
   in ~70ms with the fix present instead ran past the 2-minute cap and had
   to be killed — a stark qualitative difference consistent with
   reproducing the original incident's own symptom (the fixture's own
   `git init`/`git commit` redirected onto the linked worktree's real
   gitdir via the inherited ambient vars, racing/hanging exactly as the
   original corruption did). Did not chase a clean pass/fail message given
   the cost and risk of repeating a multi-minute real-git mutation probe;
   confirmed no corruption resulted (`git status --short` clean, no
   orphaned processes) and restored the fix from a `.bak` copy immediately.
   Combined with (1)'s clean JS-level proof and the specifier's own
   independently-measured incident writeup (quoted in the ticket's own
   approval_context), this is sufficient non-vacuity evidence without
   forcing a second multi-minute run.

## Verification

- `npm run compile`: clean.
- `vitest run test/gitEnvGuard.test.js`: 5/5 pass (was 4 in my first
  pass; +1 new for GIT_INDEX_FILE).
- `run_acceptance.sh` on the BL-1196 feature, 3 consecutive runs: 4/4
  pass every run (2 new scenarios: GIT_INDEX_FILE strip, real
  worktree-hook-environment end-to-end).
- `test_property_suite_drift_guard.sh` (this session's own BL-1202
  hardening target, sharing the same file): 16/16 pass, no regression
  from the new `unset -v` line landing alongside it.
- Standing whole-tree guards: same 4 pre-existing failures as every prior
  pass this session, none naming any BL-1196 file.

## Cleanup

No orphaned `node --test`/`stryker`/`bb`/git-hook processes at handoff
(explicit `pgrep` check after the 2-minute mutation-probe timeout,
clean). Both hand-mutated files restored from `.bak` copies, confirmed
byte-identical (`git diff` empty) before finalizing.

By hardener.
