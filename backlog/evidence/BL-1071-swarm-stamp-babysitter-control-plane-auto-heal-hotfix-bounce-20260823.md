# BL-1071 — QA bounce — 20260823

## 1. Failing command

```
cd extension && npm run test:properties
```

(the QA-required separate property command, run as its own full pass per
engineering.prompt / the QA role prompt's Verification Order — not the unit
suite, not a single-file run.)

## 2. Commit hash

`9f85ce0b93d3163b7563cb0e1e516643d8941dbd` (merge of documenter's
`fa2b43401a` into the QA worktree; documenter's own commit `fa2b43401a` is
the parcel content under review, all of it present in this merge).

## 3. First error excerpt

```
❯ test/bl1071RecoveryBoundedInTime.property.test.js (2 tests | 1 failed) 3910ms
   × BL-1071/BL-654 invariant 2: a recovery that never returns is bounded, reported unfinished, and leaves nothing behind 3599ms
     → a grandchild survived the kill (grandchild): 0 stray hangs before, 2 after

'2' !== '0'
```

Reproduced on the first of two full `npm run test:properties` runs (both run
back to back, nothing else changed in between). The second full run passed
this file but hit an unrelated pre-existing flake elsewhere
(`test/tempDirTrapGuard.property.test.js`, confirmed by `git diff` to be
untouched by any commit in this parcel — out of scope for this bounce, not
raised as a defect here).

## 4. Failure class

`unit` (property-test gate, run separately per engineering.prompt but still
a test-correctness failure, not compile/integration/acceptance/behavior).

## 5. Expected vs observed

Expected: `npm run test:properties` green on every run, including under the
concurrent, multi-process load the real gate command runs under (~470
property test files across parallel workers).
Observed: on one of two full runs, the "grandchild" hang-shape draw in
`test/bl1071RecoveryBoundedInTime.property.test.js` reported 2 stray
`sleep 3600`-pattern processes surviving the kill, where 0 are expected.
The same test passed reliably in 5 separate isolated re-runs (including one
under a 20-core synthetic CPU-load generator), so this is not a
straightforwardly-reproducible-in-isolation failure — it surfaces only under
the real gate's own concurrent-process conditions.

## Root cause (read, not fixed — QA does not fix)

`strayHangs()` in `extension/test/bl1071RecoveryBoundedInTime.property.test.js`
(around line 66-72) detects orphaned grandchildren with a host-wide,
unscoped process-table diff:

```js
function strayHangs() {
  try {
    return execFileSync('bash', ['-c', "pgrep -f '[s]leep 3600' | wc -l"], { encoding: 'utf8' }).trim();
  } catch {
    return '0';
  }
}
```

This is exactly the pattern engineering.prompt's Guardrails section forbids:
"Never... diff shared globals (`/tmp`, broad ps patterns, live runtime
paths)... redirect through env seams." No other test file in the repo uses
the `sleep 3600` marker (checked: `grep -rl "sleep 3600" test/` matches only
this file), so the two extra matches are not another test's unrelated
process — they are either (a) this test's own grandchild not yet reaped by
the OS at check time under the real gate's process/fork pressure (a timing
assumption the check has no settle/retry window for), or (b) evidence that
`run-bounded!`'s process-group kill genuinely does not reach every
grandchild under load. The test as written cannot distinguish these two
explanations from each other, which is itself the defect: it diffs a shared
global instead of scoping to its own spawned process tree (e.g., processes
under its own recorded pgid), so a pass here is not reliable evidence for
review goal 2 / invariant 2 under the conditions that actually matter (a
host under load — the same shape as the incident this ticket exists to
fix).

## Remediation pointer

`extension/test/bl1071RecoveryBoundedInTime.property.test.js`, `strayHangs()`
(coder-authored per the file's own docstring, "property authorship rests
with the coder, first pass - BL-654"). Scope the stray-process check to the
sweep's own recorded pgid/descendants instead of a host-wide `pgrep -f`
diff, or add a bounded settle/retry before asserting zero survivors — either
way, make the assertion prove something about this test's own process tree,
not the whole host's.

## Everything else in this parcel: PASS

- `pgrep -fl 'node --test|stryker'` before and after: clean, no orphans.
- `bash swarmforge/scripts/test/test_babysitter_check.sh`: ALL PASS (15
  cases, including case M's assertion that `BABYSITTER_FAKE_ENSURE_RESULT`
  is not read from source).
- `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`: ok.
- `cd extension && npm run compile`: clean.
- `cd extension && node scripts/recordTestDuration.js` (full unit suite):
  477 files / 8568 tests, all green.
- `npm run test:properties`, everything except the one file above: green
  across both full runs (470/471 and 468/470 respectively, the deltas being
  exactly the two issues named above).
- Acceptance: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1071-swarm-stamp-babysitter-control-plane-auto-heal-hotfix.feature`
  — 9/9 scenarios pass.
- `required_wiring` anchor: `bl1071BabysitterSweepSurvivalSteps` IS
  registered in `specs/pipeline/steps/index.js:609`.
- `BABYSITTER_FAKE_ENSURE_RESULT` / `BABYSITTER_ENSURE_COUNT_FILE`: confirmed
  removed from `swarmforge/scripts/babysitter_check.bb` and
  `babysitterd_sweep_lib.bb` (only a docstring comment mentions the old name,
  no live `getenv`/read of either var remains) — qa_e2e_procedure step 8
  answered: the seam is gone, not merely gated.
- `run-bounded!` duplication with `expedite_cli.bb` (coder's own follow-up
  note 7a): confirmed present, confirmed NOT extracted in this parcel,
  confirmed BL-1030 is concurrently live on `expedite_cli.bb` — deferring
  extraction is the right call per Concurrent Work Orthogonality, not a
  defect.
- Docs: `docs/how-to/BL-611-babysitterd-runbook.md` and
  `docs/how-to/BL-958-control-plane-loss-recovery.md` both updated and
  consistent with the landed behavior (spot-checked the new "two bounded
  exceptions" section and the `BABYSITTER_ENSURE_TIMEOUT_MS` mention).
- `docs/diagrams/*.mmd`: documenter's "no diagram change needed" verdict
  confirmed correct — babysitterd's internal repair control flow is out of
  both diagrams' stated scope, same precedent as BL-1017.

This bounce is narrowly for the one property-test defect above.
