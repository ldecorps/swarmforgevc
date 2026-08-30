# BL-1182 — hardener pass

Hardener, 2026-08-30. Merged architect's re-pass `604a245de3` (D1/D2 fixed
and verified; a merge-drop of the `bl1182DayLongBobTrialLifecycleSteps`
`index.js` registration was caught and repaired again — confirmed still
present and loading clean in this worktree:
`node -e "require('./specs/pipeline/steps/index.js')"` clean, both
`bl1182` and `bl1232` lines present).

## Mutation cooldown gate (BL-149)

```
extension/src/tools/trial-boundary-memory.ts   DECISION: run
swarmforge/scripts/model_steward_cli.bb        DECISION: run
swarmforge/scripts/model_steward_store.bb      DECISION: run
swarmforge/scripts/model_steward_trial_lib.bb  DECISION: run
load_avg: 3.33  cores: 20  busy_threshold: 2.00x (quiet)
```

Babashka files (`model_steward_*.bb`) have no wired mutation tool
(Engineering Rules: Babashka/Clojure — gated by their own unit-test suite
only): `model_steward_trial_lib_test_runner.bb` (ALL PASS, includes the
bounce-fix disk round-trip case), `test_model_steward_trial_cli.sh` (ALL
CHECKS PASSED), `bl1182_trial_lifecycle_property_runner.bb` (ALL PASS,
500 runs/invariant) all re-confirmed green.

## Stryker — blocked by pre-existing baseline, hand-authored sweep instead

`npx stryker run --mutate "out/tools/trial-boundary-memory.js" --concurrency 1`
requires a green whole-suite Vitest dry run (`coverageAnalysis: perTest`).
This worktree's dry run fails on an already-known, unowned pre-existing
defect unrelated to this ticket — a real-subprocess CLI test
(`backfillHumanApproval.test.js`-class "the compiled CLI runs standalone as
a subprocess..." pattern) that needs a free port/environment condition this
dry run doesn't have. This is the documented recurring Stryker-blocked-by-
baseline shape (see BL-1228/BL-387/BL-607/etc. hardener passes) — the
same 26-failed-file/218-failed-test standing baseline the architect and this
pass both re-confirmed unchanged. Not this ticket's defect.

Per the BL-638 no-run-tool fallback, hand-authored the mutation sweep
instead, against the compiled `out/tools/trial-boundary-memory.js`, running
`npx vitest run test/trialBoundaryMemory.test.js` after each hand-applied
mutation, restoring afterward:

- `if (!role)` → `if (role)` — KILLED
- boundary guard `||` → `&&` — KILLED
- `if (!targetPath)` → `if (targetPath)` — KILLED
- `outcome.ok ? {...} : {...}` ternary condition negated — KILLED
- `captured: outcome.captured` → hardcoded `captured: true` — SURVIVED on
  first pass (no test asserted `report.captured` in the failure branch, and
  the failure fixture always had `outcome.captured === true`, so the
  hardcode was indistinguishable). **Fixed**: added
  `'passes through a false captured flag when the capture step itself
  failed'` asserting `report.captured === false` against a fixture where
  the transfer fails before capture completes (a real production shape —
  `runMemoryTransferForRole` can fail with `captured: false`). Re-ran: KILLED.
- `main`'s `return report.ok ? 0 : 1` ternary negated — KILLED
- `main`'s catch-branch `return 2` → `return 3` — KILLED
- `flag('summary') ?? ''` → `|| ''`: **accepted equivalent (BL-234)**.
  `flag()` returns either `undefined` or the literal argv string that
  followed `--summary`, including a legitimate explicit empty string
  (`--summary ''`). `??` and `||` differ only when the left side is a
  defined-but-falsy value; here the only such value (`''`) is also the
  fallback value itself, so both operators produce byte-identical output for
  every possible input. Same reasoning applies to `deps.buildState ??
  buildOutgoingCaptureState` / `deps.transfer ?? runTrialBoundaryMemoryTransfer`
  in `runTrialBoundaryMemory` — both fallback values are functions, always
  truthy, so `??`/`||` agree on every input. Not chased into a test.

All mutants restored; final compiled file diffed byte-identical against the
pre-mutation copy before re-running the suite clean.

## Test additions (closing two real gaps, not just the sweep survivor)

`extension/src/tools/trial-boundary-memory.ts`'s `main()` had zero coverage
of its own exit-status contract (the file's own header: "The exit status IS
the contract the caller needs") beyond the parse-error path (exit 2). Gave
`main()` an optional `deps` parameter (threaded to `runTrialBoundaryMemory`,
behavior-preserving — the real CLI invocation at the bottom of the file is
unchanged, still calls with no deps) and added:
- exit 0 + `report.ok === true` on a successful transfer
- exit 1 + `report.ok === false` + signal on a failed transfer
- the `captured: false` passthrough case above

`extension/test/trialBoundaryMemory.test.js`: 9 → 12 tests, all green.

## CRAP

```
parseTrialBoundaryArgs   complexity=6  coverage=100%  CRAP=6.00
runTrialBoundaryMemory   complexity=4  coverage=100%  CRAP=4.00
main                     complexity=3  coverage=100%  CRAP=3.00
flag                     complexity=2  coverage=100%  CRAP=2.00
```
All <= 6. (`.bb` files: no CRAP tool wired, per Engineering Rules.)

## DRY

`npx jscpd src/tools/trial-boundary-memory.ts --min-lines 10`: 0 clones.

## Full re-verification after the test additions

- `bb model_steward_trial_lib_test_runner.bb`: ALL PASS
- `bash test_model_steward_trial_cli.sh`: ALL CHECKS PASSED
- `bb bl1182_trial_lifecycle_property_runner.bb`: ALL PASS, 500/invariant
- `npx vitest run test/trialBoundaryMemory.test.js`: 12/12
- `node specs/pipeline/cli.js specs/features/BL-1182-*.feature`: 5/5
- Whole-tree standing guards (parcel touches `extension/test/` and
  `specs/pipeline/steps/`): ran all 17 non-property `test/*Guard*.test.js`.
  3 failed — `liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
  `tempDirTrapGuard` — the same confirmed pre-existing standing-red set
  named in this same day's `BL-1277`/`BL-1232` hardener passes; none names
  `bl1182` or either changed source file.
- Full `npx vitest run`: 26 failed / 218 failed, 550/576 files passed
  (up from 549/575 pre-pass — the 3 new tests all pass) — identical failure
  count to the standing baseline. No regression.

## Orphan process check

`pgrep -f 'node --test|stryker|vitest'` showed several hits, all confirmed
by `/proc/<pid>/cwd` to belong to the **coder** worktree (a concurrent,
unrelated session), none in this hardener worktree. Nothing leaked here.

## Verdict

Hardened. Real gap found and closed (uncovered `captured` passthrough on
main's failure branch); one accepted equivalent recorded (`??` vs `||`,
BL-234); Stryker itself blocked by an already-known, unowned baseline
defect, hand-authored sweep substituted per BL-638. Forwarding to
documenter.
