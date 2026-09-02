# BL-1271 — architect re-pass after QA bounce, 2026-09-02

Reviewed cleaner rework commit `03b3501b6f` ("cleaner rework — restore both
original assertion names (QA bounce 991ec6ead8, invariant 2)"), merged into
this worktree.

## D1 (from BL-1271-qa-bounce-20260902.md) verification
- `grep -n '"top-expedited-paused-candidate-08 (BL-900): called with no
  epic-index (1-arity) still ranks by own priority, unchanged"'
  swarmforge/scripts/test/dispatch_gap_test_runner.bb` → line 556, present.
- `grep -n '"top-expedited-paused-candidate: priority breaks ties among
  multiple expedited candidates"'
  swarmforge/scripts/test/dispatch_gap_test_runner.bb` → line 562, present.
- Both original assertion names restored verbatim, as two byte-identical
  `assert=` forms (intentional pre-existing duplication, per the cleaner's
  own comment at lines 547-555). Invariant 2 ("every assertion name present
  before this ticket is still present after it") now holds.
- `top-expedited-paused-candidate-09 (BL-1271)` still present (line 573) —
  required_wiring's retired-type guard intact.

## Checks run
- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — ALL PASS.
- `specs/pipeline/steps/index.js` still registers
  `bl1271DispatchGapDefectOnlySteps` (line 409).
- `promotion_gates_lib.bb` `expedited-types` still `#{"defect"}` — invariant 1
  unaffected by this rework.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1271-dispatch-gap-suite-stale-bug-fixtures.feature` —
  3/3 scenarios pass.

## Verdict
D1 resolved correctly. No new defect introduced by the rework. Forwarding to
hardener.
