# BL-1271 — hardener re-pass after QA bounce (20260902)

Received architect commit `c96c3570b6` (re-verifying cleaner rework
`03b3501b6f`, which restored both original assertion names QA's bounce
(`991ec6ead8`) found deleted/renamed in violation of the ticket's own
invariant 2).

## D1 verification (own check, not merely trusting architect's re-pass)

- `grep -n '"top-expedited-paused-candidate-08 (BL-900): called with no
  epic-index (1-arity) still ranks by own priority, unchanged"'
  swarmforge/scripts/test/dispatch_gap_test_runner.bb` → line 556, present.
- `grep -n '"top-expedited-paused-candidate: priority breaks ties among
  multiple expedited candidates"'
  swarmforge/scripts/test/dispatch_gap_test_runner.bb` → line 562, present.
- `top-expedited-paused-candidate-09 (BL-1271)` still present at line 573.
- All three now coexist as intentional pre-existing byte-identical
  duplicates (per the cleaner's own comment) — invariant 2 holds.

## Re-ran the revert-check (qa_e2e_procedure step 4) once more against the
rework, same as my first pass

Widened `expedited-types` to `#{"defect" "bug"}`: exactly the same two
failures as before (`top-expedited-paused-candidate-09 (BL-1271)` and
`promotion_gates_lib`'s own "retired type: bug + high is not expedited"),
nothing else moved. Reverted; `git diff --stat` on
`promotion_gates_lib.bb` confirmed byte-identical afterward; both suites
green again.

## Verification (all green)

- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — ALL PASS
- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — ALL PASS
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1271-dispatch-gap-suite-stale-bug-fixtures.feature`
  — 3/3

## Verdict

No defect in this ticket's own domain, on this rework either. Nothing for
a hardener to add — same as my first pass, no commit of my own needed.
Forwarding unchanged to documenter.

By hardener.
