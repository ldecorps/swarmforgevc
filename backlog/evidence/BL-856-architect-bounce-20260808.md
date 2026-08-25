# BL-856 architect bounce — 20260808

Commit reviewed: 4ad363eed5dba52d81e6a81b734ae51333080c8b ("BL-856: a failed
integrity commit no longer leaves work staged").

## Checklist run

- **Correctness of the fix itself:** confirmed sound. Snapshot-then-restore
  design in `commit_integrity_lib.bb`'s `commit-with-integrity!` is
  pathspec-scoped, distinguishes the pre-add snapshot (used for
  `:add-failed`/`:commit-failed`) from the post-commit snapshot (used for
  `:verify-mismatch`, correctly avoiding the "drag the index backward to a
  stale blob" regression the ticket describes), and reports
  `:index-left-dirty` when the restore itself cannot complete. Ran:
  - `bb swarmforge/scripts/test/commit_integrity_lib_test_runner.bb` — ALL
    TESTS PASSED (covers every declared invariant, including the real-git
    :verify-mismatch regression the ticket calls out).
  - `bash specs/pipeline/scripts/run_acceptance.sh
    specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`
    — 9/9 scenarios green.
  - `bash swarmforge/scripts/test/test_commit_integrity_cli.sh` — ALL PASS,
    including the close-guard-rejection case.
- **Declared invariants (BL-633/BL-654):** all three covered by targeted
  real-git unit tests (no bb-side property-test harness exists — a stated,
  valid non-encodability reason per engineering.prompt's documented Babashka
  gap). No missing or vacuous property test.
- **`.bb` toolchain:** no dependency-gate/co-change applicable (TS-only
  tools; this ticket's scope is pure `.bb`).
- **Acceptance-scenario outline coverage vs. ticket constraint** ("Cover them
  [`:no-git-dir`, `:lock-timeout`] in the outline anyway"): `:lock-timeout` is
  in the Scenario Outline's Examples; `:no-git-dir` is covered by the unit
  runner (lines 83-84, "a non-git-repo project-root reports :no-git-dir").
  Satisfied.

## Defect found

**D1 — step handlers registered unscoped, violating this ticket's own
explicit constraint.**

- **Class:** behavior (spec-compliance / correctness defect visible on
  review, per architect.prompt's "a correctness defect you can SEE is a
  send-back too").
- **Site:**
  `specs/pipeline/steps/bl856FailedCommitMustNotLeaveWorkStagedSteps.js:90`
  — `registry.define(/^the call reports failure$/, ...)`.
- **The ticket's own Constraints section says, verbatim:** "Register step
  handlers scoped to this feature; text like 'the call reports failure' must
  not be registered unscoped (BL-425)." The coder registered exactly that
  named phrase via the plain, unscoped `registry.define`, not
  `registry.defineScoped(pattern, handler, featureName)`
  (`specs/pipeline/stepRegistry.js`'s scoping mechanism, already present on
  `main` since BL-425 — not something this parcel needed to add).
- **Verified no other site in this file needs the same fix:** swept every
  other `registry.define(...)` call in
  `bl856FailedCommitMustNotLeaveWorkStagedSteps.js` (16 registrations total)
  against every other `*.js` file under `specs/pipeline/steps/` for literal
  duplicate step text — no other phrase in this file collides today, and no
  other phrase in this file is named by the ticket as needing scoping. D1 is
  the complete site list for this issue.
- **Remediation pointer:** in `bl856FailedCommitMustNotLeaveWorkStagedSteps.js`,
  change the `registry.define(/^the call reports failure$/, ...)`
  registration to `registry.defineScoped(pattern, handler, FEATURE_NAME)`
  with `FEATURE_NAME` set to this feature's exact `Feature:` title (the same
  pattern `bl425RoleSteeringTopicsSteps.js` already establishes, including its
  explanatory comment on why scoping applies here).

## Verdict

Sending back to coder. No architecture-rule or dependency-gate violations;
the `.bb` fix itself is correct and well-tested — this is a single,
narrowly-scoped spec-compliance defect against the ticket's own stated
constraint.
