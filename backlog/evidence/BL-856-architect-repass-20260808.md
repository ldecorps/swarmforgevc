# BL-856 failed-integrity-commit-leaves-work-staged — architect re-pass — 20260808

Commit reviewed: `2a553f9597` (cleaner's forward), received as
`merge_and_process cleaner 2a553f9597`, merged into this branch as `22a30488`
before any check below was run.

## Context: D1 remediation round-trip

My prior pass (`backlog/evidence/BL-856-architect-bounce-20260808.md`) found
one defect — D1, the "the call reports failure" step text registered
unscoped, violating this ticket's own explicit Constraints-section text
(BL-425 scoping) — and bounced to coder. This pass verifies the fix and
re-reviews everything downstream of it.

## Checklist run

- **D1 fix verification:** `git diff 129cfca327..HEAD --
  specs/pipeline/steps/bl856FailedCommitMustNotLeaveWorkStagedSteps.js` shows
  no further change — coder's fix (`129cfca327`) is exactly what remediation
  asked for: `registry.defineScoped(/^the call reports failure$/, handler,
  FEATURE_NAME)` with `FEATURE_NAME = 'a failed integrity commit leaves the
  index exactly as it found it'`, matching the feature file's `Feature:`
  title verbatim (`grep '^Feature:'
  specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`)
  and the `defineScoped(pattern, handler, featureName)` signature already
  established by `bl425RoleSteeringTopicsSteps.js`. D1 is closed.
- **`.bb` unit suite:** `bb
  swarmforge/scripts/test/commit_integrity_lib_test_runner.bb`: ALL TESTS
  PASSED.
- **CLI shell suite:** `bash
  swarmforge/scripts/test/test_commit_integrity_cli.sh`: 5/5 PASS, including
  the close-guard-rejection case.
- **Acceptance:** `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`:
  9/9 scenarios green.
- **Declared invariants (BL-633/BL-654):** all three (index-exactly-as-found,
  pathspec-scoped restore, loud failure on unrestorable index) still covered
  by the same targeted real-git unit tests my bounce pass verified — nothing
  in the `.bb` logic changed since, only the step-handler scoping. No
  bb-side property-test harness exists; the stated non-encodability reason
  (BL-472 Babashka gap) still holds.
- **`.bb` toolchain (unchanged from my bounce pass):** no dependency-
  gate/co-change tooling applies — TS-only tools, this ticket's scope is
  pure `.bb` plus one JS step-registration fix.
- **Cleaner's remediation:** read `BL-856-cleaner-pass-20260808.md` — real
  review of all 6 files the ticket touches, explicit NONE (no further
  cleanup needed on top of the minimal D1 fix), same three test commands
  re-run and confirmed green independently.
- **No new defect introduced by the fix:** `defineScoped` only changes
  resolution scoping for this one phrase within this one feature; grepped
  `specs/pipeline/steps/` for any other file registering `the call reports
  failure` — none found, so scoping this instance cannot regress another
  feature's step resolution.

## Verdict

**NONE** — no defects found. D1 is correctly and minimally fixed. Forwarding
to hardener.
