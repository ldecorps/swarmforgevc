# BL-856 failed-integrity-commit-leaves-work-staged — cleaner pass — 20260808

Reviewed against `129cfca327` (coder's fix for architect bounce D1 —
`registry.defineScoped` for the "the call reports failure" step text —
merged onto commit `4ad363eed5`, the ticket's original implementation).

## Files reviewed

- `swarmforge/scripts/commit_integrity_lib.bb`
- `swarmforge/scripts/commit_integrity_cli.bb`
- `swarmforge/scripts/test/commit_integrity_lib_test_runner.bb`
- `swarmforge/scripts/test/commit_integrity_856_scenarios_cli.bb`
- `swarmforge/scripts/test/test_commit_integrity_cli.sh`
- `specs/pipeline/steps/bl856FailedCommitMustNotLeaveWorkStagedSteps.js`

## Toolchain note (engineering.prompt)

`.bb` files have no wired mutation/CRAP/DRY tooling (BL-472, deliberately
deferred). The gate here is the `.bb` unit-test suite plus manual structural
review, not the TS quality scripts.

## Verdict: explicit NONE

- `bb swarmforge/scripts/test/commit_integrity_lib_test_runner.bb`: ALL
  TESTS PASSED.
- `bash swarmforge/scripts/test/test_commit_integrity_cli.sh`: ALL PASS
  (5/5, including the close-guard-rejection case).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`:
  9/9 scenarios green.
- Manual read of `commit_integrity_lib.bb`: `commit-with-integrity!` is
  already decomposed into named single-purpose helpers
  (`default-add!`, `default-commit!`, `default-snapshot-index`,
  `default-restore-index!`, `acquire-lock!`/`release-lock!`), every
  non-obvious branch (why two distinct snapshot points, why pathspec-scoped
  restore, why the lock is bounded) carries a comment explaining the WHY,
  and all side effects are injectable seams — no duplication or unclear
  structure found.
- The step-handler fix (`registry.defineScoped` + `FEATURE_NAME` constant)
  is the minimal, correctly-scoped change the bounce asked for; no further
  cleanup warranted there.

No cleanup changes made.

## Forward

`git_handoff` to architect, priority `00`, task name unchanged
(`BL-856-failed-integrity-commit-leaves-work-staged`).
