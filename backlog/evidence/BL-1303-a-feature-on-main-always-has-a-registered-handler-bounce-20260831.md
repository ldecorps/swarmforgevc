# BL-1303 architect bounce — 2026-08-31

Reviewed commit: 1ad04298d3 (cleaner: split the oversized feature-handler
assessor), merged into swarmforge-architect as 7d782800ad.

## Checks that passed

- Dependency gate (`extension/out/tools/dependency-gate.js`) on all five
  touched TS files: PASSED, no forbidden edges, acyclic.
- Co-change report on the same files: only low counts (1-2) against
  siblings created in the same commit — expected for a fresh split, not
  coupling to flag.
- `npm run compile` (extension/): clean.
- Unit tests `featureHandlerRegistrationCheck.test.js`,
  `checkFeatureHandlerRegistrationCli.test.js`: 29/29 pass.
- Property tests `bl1303FeatureHandlerRegistration.property.test.js`,
  `bl1252CommitGuardAggregationInvariants.property.test.js`
  (`npm run test:properties` config): 8/8 pass.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1303-a-feature-on-main-always-has-a-registered-handler.feature`:
  7/7 scenarios pass.
- Shell fixture `swarmforge/scripts/test/test_check_feature_handler_registration.sh`:
  7/7 pass.
- The two declared invariants (fail-closed; one pass reports every offender)
  are both encoded and exercised — no send-back on Invariants Review.
- required_wiring anchor 1 (`run_commit_guards.sh::run_guard
  check_feature_handler_registration.sh`): present at
  `swarmforge/scripts/run_commit_guards.sh:83`.
- required_wiring anchor 3 (`specs/pipeline/steps/index.js::bl1303`):
  present at `specs/pipeline/steps/index.js:906`
  (`require('./bl1303FeatureHandlerRegistrationSteps')`).

## D1 — required_wiring anchor 2 unmet: merge path still unguarded (behavior)

The ticket's own required_wiring list (amended by the specifier in
c6c264a8d5, "the guard never fires on the merge path - both incidents
arrived by merge") states:

> `swarmforge/git-hooks/pre-merge-commit::check_feature_handler_registration.sh::the
> guard must be added to the commit-guard chain ... the guard must ALSO be
> reached on the --no-ff merge path.`

Checked on the tip of this parcel (7d782800ad):

    $ grep -n "check_feature_handler_registration\|check_pipeline_code_on_main" \
        swarmforge/git-hooks/pre-merge-commit
    12:"$REPO_ROOT/swarmforge/scripts/check_pipeline_code_on_main.sh"

`pre-merge-commit` still execs only `check_pipeline_code_on_main.sh`, byte
for byte identical to before this ticket started
(`git log --oneline --all -- swarmforge/git-hooks/pre-merge-commit` shows no
commit for this file newer than `ecf9e3dacc`, BL-632). No commit in this
parcel's history (`e794daad30` through `1ad04298d3`) touches this file.

This is not a missing test — the wiring itself does not exist. Effect: the
guard fires on `pre-commit` only, so `git merge --no-ff`, which is how QA
lands every approved commit and how BOTH incidents this ticket cites
(BL-1253's resurrecting merge, BL-709's merge `45625ef9cb`) put `main` into
the bad state, is still completely unguarded. The parcel as it stands does
not deliver the half of its own title that matters most — a plain `git
commit` on `main` was already a comparatively rare way to introduce this
defect; the merge path is the one that actually bit twice.

The ticket explicitly forbids the two easy wrong fixes (repointing
`pre-merge-commit` at `run_commit_guards.sh` wholesale; a sequential `set -e`
chain of the two guards) and asks for a combined-status wrapper instead,
consistent with `check_pipeline_code_on_main.sh` + the new guard both
running and both able to report.

## Remediation

Add the second guard invocation to `swarmforge/git-hooks/pre-merge-commit`,
capturing and combining both guards' exit statuses (neither `set -e`
short-circuit nor silent masking — same shape `run_commit_guards.sh` already
uses per BL-1242/BL-1252), e.g.:

    status=0
    "$REPO_ROOT/swarmforge/scripts/check_pipeline_code_on_main.sh" || status=$?
    "$REPO_ROOT/swarmforge/scripts/check_feature_handler_registration.sh" "$REPO_ROOT" || status=$?
    exit "$status"

Add or extend a shell fixture exercising the actual `--no-ff` merge path
(qa_e2e_procedure step 6 describes the manual version of this check) so the
wiring anchor has a regression test, not just a grep-able line.

## Disposition

Bounced to coder (owns the required_wiring implementation gap). Recorded via
record-bounce.js below; class `behavior` (a required, ticket-mandated wiring
edge that does not exist, discovered by reading the file — not an
architecture-boundary or invariant-coverage issue).
