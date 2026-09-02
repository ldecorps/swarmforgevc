# BL-1271 — hardener pass (20260902)

Received in a 2-item batch with BL-1338 (architect commit `8d0c014466`,
forwarded unchanged from cleaner, on top of coder).

## Scope

Fixture-only repair: no production `.bb` logic changed (confirmed via
`git diff 8d0c014466^^ 8d0c014466 --stat` — touches only
`swarmforge/scripts/test/dispatch_gap_test_runner.bb`, a new step-handler
file, and `specs/pipeline/steps/index.js`'s registration line).
`swarmforge/scripts/promotion_gates_lib.bb` and `chase_sweep_lib.bb` are
untouched, exactly as `out_of_scope:` requires.

## BL-149 cooldown gate

`swarmforge/scripts/test/dispatch_gap_test_runner.bb` — skip-cooldown
(0.22 days old, still actively churning from today's own pass — that is
this ticket's own repair, not something to mutation-test further this
pass).

## qa_e2e_procedure step 4, run by the hardener as the mutation-equivalent check

Since there is no production logic for a mutation tool to cover, ran the
ticket's own prescribed revert-check by hand: temporarily widened
`expedited-types` in `promotion_gates_lib.bb` from `#{"defect"}` to
`#{"defect" "bug"}`, re-ran both suites:

- `dispatch_gap_test_runner.bb` → exactly ONE failure, the new
  `top-expedited-paused-candidate-09 (BL-1271)` assertion (expected
  `BL-B`, got `BL-A` — the retired `bug` type won once the lane was
  widened, exactly the regression this assertion exists to catch).
- `promotion_gates_lib_test_runner.bb` → exactly ONE failure, its own
  pre-existing "retired type: bug + high is not expedited" assertion
  (invariant 1 — unaffected by this ticket, still guards the predicate
  independently).

No other assertion in either suite moved. Reverted the edit
(`git diff --stat` on `promotion_gates_lib.bb` confirmed byte-identical
afterward); both suites green again.

## Verification (all green)

- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — ALL PASS
- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — ALL PASS
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1271-dispatch-gap-suite-stale-bug-fixtures.feature`
  — 3/3
- Full extension unit suite: unaffected by this ticket (no extension/
  files touched); ran as part of the batch's combined pass, see
  BL-1338's evidence file for the full-suite result.

## Invariant check (ticket's own invariant 2: assertion names preserved, none dropped)

Diffed assertion names before/after (per the ticket's own note and the
architect's already-completed check): the merged assertion's name
contains BOTH prior contract names verbatim
(`top-expedited-paused-candidate-08 (BL-900): ... / priority breaks ties
among multiple expedited candidates`), and the new
`top-expedited-paused-candidate-09 (BL-1271)` is additive. Confirmed by
reading the diff directly, not re-derived — matches architect's own
finding.

## Verdict

No defect in this ticket's own domain. Nothing for a hardener to add:
the repair is complete, its own revert-check (qa_e2e_procedure step 4)
passes precisely as specified, and there is no production code for
mutation to cover. Forwarding unchanged (no commit of my own for this
ticket) to documenter.

By hardener.
