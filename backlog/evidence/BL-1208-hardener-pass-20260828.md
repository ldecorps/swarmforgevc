# BL-1208 hardener pass — 2026-08-28

Merged architect handoff `860fff455d` (clean pass, restoration-not-authorship
guard verified). No conflicts.

## Stryker mutation — BLOCKED by a known, already-ticketed environmental defect

`mutation_cooldown_gate.bb` returned `DECISION: run` for both touched files
(`bounceRevertVerdict.ts`, `bounceRevertGitAdapter.ts`; 8.49 days old, host
quiet). Attempted a scoped Stryker run
(`--mutate out/quality/bounceRevertVerdict.js`); Stryker's dry run requires
the WHOLE unit suite green and refused to start:

- First attempt: `startBridgeHeadlessCli.test.js`'s subprocess CLI test
  failed — the compiled bridge CLI needs `CURSOR_API_KEY`, unset in this
  environment.
- Set a fake `CURSOR_API_KEY` to get past that; a SECOND, different file
  (`backendSwitch.test.js`) then failed instead.

This is **BL-720**'s exact documented shape (ticketed 2026-07-30):
`cursorBridgeAgentSession.test.js` unconditionally `delete`s
`process.env.CURSOR_API_KEY` in several tests' `finally` blocks instead of
restoring the prior value, and because `vitest.config.mjs` runs with
`pool: 'forks'`/`isolate: false`, that mutation leaks across files sharing
a worker — which unrelated file fails depends on fork/file scheduling,
confirmed non-deterministic. BL-720 is `type: defect`, `severity: high`,
already ticketed 2026-07-30, `human_approval: pending`, and its own record
says explicitly **"Do NOT re-file."** Confirmed both failing test files
(`startBridgeHeadlessCli.test.js`, `backendSwitch.test.js`) are
byte-identical to `origin/main` — neither is a regression from any merge
in this worktree, and neither touches `src/quality/`, `src/metrics/`, or
any BL-1208 file.

**Recorded here per Article 4.4 (BLOCKED item, not a pass and not an
omission)**: Stryker BLOCKED BY BL-720. Falling back to hand-authored
mutation on the two touched files (below), matching the BL-638 fallback
discipline for a tool that is configured but environmentally unreachable
this pass.

## Hand-authored mutation, both hand-verified non-vacuous

1. `decideBounceRevertVerdict`'s `anyAuthored = liveFiles.some((f) =>
   !f.restoredFromEarlierHistory)` — flipped `.some` to `.every` in the
   compiled JS. Confirmed exactly one test fails: "ANY live file not
   established as restored still earns the remedy, even alongside restored
   siblings" (the isolating mixed-file case this mutation needs to be
   caught by). Restored; 23/23 pass again.

2. **A real, previously-untested branch found via CRAP** (`existedIdenticallyBeforeLoss`
   at 80% coverage, not 100%): the `if (log.status !== 0) { return false; }`
   fail-safe in `bounceRevertGitAdapter.ts` had no test reaching it — every
   real-git fixture in the suite gives this `git log` call a resolvable
   parent, which always succeeds regardless of the path's own history, so
   the failure branch is unreachable via a real git fixture at all (only a
   directly-injected `runGit` can reach it, since `gatherBounceRevertFacts`
   takes `runGit` as a real parameter). Added
   `BL-1208: a git-log failure while checking prior history is NOT read as
   "restored"...` using a fake `runGit`. First version of the test was
   itself vacuous (empty fake `stdout` meant removing the status guard
   didn't change the outcome — `''.split('\n').filter(...)` is `[]` either
   way); caught by hand-verifying the mutant did NOT fail the test, fixed by
   making the fake `log` call return a real-looking commit hash in `stdout`
   whose own `git show` would match the bounced content, so removing the
   guard measurably flips the result. Re-verified: the fixed test passes on
   real code, and **fails** when the guard is deleted from compiled JS
   (`true !== false` on `restoredFromEarlierHistory`). Restored; recompiled
   from source; 24/24 pass, `existedIdenticallyBeforeLoss` now 100% coverage.

## Verification

- `npm run compile`: clean.
- `vitest run test/bounceRevertRestoration.test.js test/bounceRevertCheck.test.js`:
  24/24 pass (was 23; +1 new).
- `vitest run --config vitest.properties.config.mjs bl954BounceRevertCheckInvariants`:
  3/3 pass (BL-954's own property invariants, unedited per the ticket's
  regression constraint).
- `run_acceptance.sh` on the BL-1208 feature, 3 consecutive runs: 4/4 pass
  every run.
- CRAP scoped to both touched files: `decideBounceRevertVerdict` at CRAP
  6.00 (at threshold, not over — complexity 6, 100% coverage), every other
  function at or under 4.00. `existedIdenticallyBeforeLoss` now 100%
  coverage (was 80%).
- DRY (`jscpd`) on both touched files: 0 clones.
- Standing whole-tree guards (parcel added
  `bl1208RestorationNotAuthorshipSteps.js` under `specs/pipeline/steps/`
  and a new test file under `extension/test/`): same 4 pre-existing
  failures as every prior pass this session, none naming any BL-1208 file.

## Cleanup

No orphaned `node --test`/`stryker` processes at handoff. Deleted my own
scratch probe dir (`/tmp/bl1208-cli-probe`) and the two `origin/main`
comparison copies I pulled to confirm the CURSOR_API_KEY/backendSwitch
failures were pre-existing, not mine.

By hardener.
