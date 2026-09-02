# BL-1271 — cleaner pass (20260902)

Received: coder commit `ddb8f766d8` (BL-1271: repair the two stale
`type: bug` fixtures, and pin the retirement at that call site).

## Cleaner action taken

The ticket's own note flagged that, after the fixture repair, two
assertions in `dispatch_gap_test_runner.bb` —
`top-expedited-paused-candidate-08 (BL-900)` and
`top-expedited-paused-candidate: priority breaks ties among multiple
expedited candidates` — call the identical 1-arity form against
byte-identical fixtures and differ only in name. Consolidated them into one
assertion per the ticket's invariant 2: the surviving name states BOTH
contracts verbatim (`... unchanged / priority breaks ties among multiple
expedited candidates`) and neither original name was dropped.

## Checklist run

- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — ALL PASS
  (after the consolidation).
- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — ALL
  PASS (unchanged; invariant 1's "retired type: bug + high is not
  expedited" assertion still present).
- Confirmed `swarmforge/scripts/promotion_gates_lib.bb` has zero diff
  against `main` (invariant 1 / out_of_scope — the expedite predicate
  itself is untouched).
- Assertion-name diff, before vs after: every name present before this
  ticket is still present after it (the merged name is the two originals
  joined), plus the new
  `top-expedited-paused-candidate-09 (BL-1271)` guard (invariant 2, per
  the ticket's own qa_e2e_procedure step 3).
- Revert-check (qa_e2e_procedure step 4): locally widened
  `expedited-types` to `#{"defect" "bug"}`, re-ran the suite — exactly
  `top-expedited-paused-candidate-09 (BL-1271)` went RED
  (`expected: "BL-B", actual: "BL-A"`), nothing else did; discarded the
  edit and confirmed the diff is clean again.
- Ran the acceptance feature for real:
  `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1271-dispatch-gap-suite-stale-bug-fixtures.feature` —
  3/3 scenarios pass, all three handlers resolve (the runner throws on a
  missing handler, so this also confirms
  `bl1271DispatchGapDefectOnlySteps` is registered, not merely written —
  the ticket's required_wiring line).
- `jscpd` over the new step-handler module — 0 clones.

## Verdict

One legitimate consolidation applied (duplication the ticket itself named
as the cleaner's to judge); everything else in coder's commit was already
correct. No other defect found in cleaner's domain. Forwarding with this
one fix.

By cleaner.
