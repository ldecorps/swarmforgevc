# BL-1271 — architect pass (20260902)

Received: cleaner commit `f9d4cba01d` (consolidated the now-duplicate
1-arity expedite assertions per the ticket's own invariant-2 note).

## Checks run

- `node extension/out/tools/dependency-gate.js ../specs/pipeline/steps/bl1271DispatchGapDefectOnlySteps.js ../specs/pipeline/steps/index.js`
  — flags one forbidden `acyclic` edge, but it is `bl726Bl718...Steps.js ->
  index.js`, not touched by this parcel's diff (`git diff
  df349fbc73...f9d4cba01d --name-only` has no `bl726` file) and already
  ticketed: `backlog/paused/BL-1331-break-bl726-index-require-cycle.yaml`
  (grepped `backlog/` for the module basename before treating this as
  bounce-worthy, per the BL-759 lesson). A full-repo scan
  (`node extension/out/tools/dependency-gate.js`, no args) at this HEAD
  also passes clean. Not a defect in this parcel.
- `node extension/out/tools/co-change-report.js` over the three changed
  files — every co-change is frequency 1, well under the default
  threshold of 3. No suspected coupling.
- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — ALL
  PASS; confirmed `swarmforge/scripts/promotion_gates_lib.bb` has zero
  diff against the parcel base (invariant 1 / out_of_scope respected).
- Independently re-ran the revert-check myself (qa_e2e_procedure step 4):
  widened `expedited-types` to `#{"defect" "bug"}` locally, re-ran the
  dispatch-gap suite — exactly `top-expedited-paused-candidate-09
  (BL-1271)` went red (`expected: "BL-B", actual: "BL-A"`), nothing else
  did. Restored the file; `git diff` on it is clean again.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1271-dispatch-gap-suite-stale-bug-fixtures.feature` —
  3/3 scenarios pass, confirming `bl1271DispatchGapDefectOnlySteps` is
  registered (not merely written) per required_wiring.
- Read `specs/pipeline/steps/index.js`'s diff — a single-line addition,
  no reordering, no duplicate registration.

## Invariants review

- Invariant 1 (expedite predicate stays defect-only): encoded by the
  pre-existing, unchanged `promotion_gates_lib_test_runner.bb` assertion;
  reran it green, file untouched.
- Invariant 2 (repair fixtures, never delete/rename/weaken an assertion):
  not independently encodable as a runtime test (it is a claim about the
  diff shape itself); verified by hand via the assertion-name diff — the
  merged name's text contains both original names verbatim, and the new
  BL-1271-09 assertion is additive. No weakened or dropped assertion
  found.

## Architecture / boundary review

- New file `specs/pipeline/steps/bl1271DispatchGapDefectOnlySteps.js` is
  test-registry code (acceptance step handlers), not extension-host,
  webview, or VS Code API surface — the two-layer and webview-storage
  rules do not apply here. It spawns `bb` via `child_process.spawnSync`
  to drive the real predicate/suite, which is the correct testable-module
  pattern (system boundary is the subprocess call, not VS Code).
- One `blNNNN…Steps` module per ticket, as required — not appended to an
  existing module.

## Property testing

- Touched module (`bl1271DispatchGapDefectOnlySteps.js`) is a thin
  subprocess-driving step-handler file, not a pure module with an
  invariant suited to property-based testing (round-trip, idempotence,
  ordering). No new property test needed; not manufacturing a vacuous
  one.

## Correctness read

- No defect spotted. The new BL-1271-09 assertion's fixtures match the
  ticket's scenario 02 exactly (bug candidate at the better own priority,
  defect at the worse one, defect still wins), and the consolidated
  assertion's merged name states both prior contracts as the ticket's own
  note required.

## Verdict

Clean sweep. Forwarding to hardener unchanged.

By architect.
