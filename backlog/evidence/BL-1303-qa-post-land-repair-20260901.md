# BL-1303 — QA post-land repair (incomplete tip-pure replay)

## What happened

The BL-1241 land-step remedy (`land_step_cli.bb`) produced a `LAND_REPLAY`
tip for BL-1303, reviewed and landed as `0f41893571` (pushed to
`origin/main`), followed by a bookkeeping commit `7110101164` recording
`abandoned_commits: [ab8d10a8b3]`. Both were pushed this session.

Post-push review (running the ticket's own acceptance feature) showed the
replay tip was INCOMPLETE: it carried the guard's shell script, doc/spec
updates, and `featureHandlerRegistrationCheck.ts`, but dropped several files
that are genuinely BL-1303's own:

- `extension/src/tools/check-feature-handler-registration.ts` (CLI entry point)
- `extension/src/tools/featureHandlerRegistrationReport.ts`
- `extension/src/tools/featureHandlerRegistrationText.ts`
- `extension/src/tools/featureHandlerRegistrationTypes.ts`
- `extension/test/bl1303FeatureHandlerRegistration.property.test.js`
- `extension/test/checkFeatureHandlerRegistrationCli.test.js`
- `specs/pipeline/steps/bl1303FeatureHandlerRegistrationSteps.js`
- `swarmforge/scripts/test/test_check_feature_handler_registration.sh`
- the `require('./bl1303FeatureHandlerRegistrationSteps')` line in
  `specs/pipeline/steps/index.js`

Root cause: `specs/pipeline/steps/index.js` is a file shared by nearly every
ticket that registers a step handler, so the own-paths replay correctly
declined to overwrite it wholesale (it already carried BL-1315's own line on
`origin/main`) rather than reconcile it at line granularity. The other
missing files are genuinely BL-1303-only but were not carried by the replay
either — confirmed by diffing `ab8d10a8b3` (the original, complete, QA-
verified merge) against the replay tip and finding these as the only
non-lifecycle, non-BL-1298 gap (`comm -23` of tree listings, cross-checked
against ticket history: BL-1040/BL-1300/BL-1315/BL-1298 moved backlog state
between `ab8d10a8b3` and now for unrelated reasons and are correctly absent).

Impact if left unrepaired: `featureHandlerRegistrationCheck.ts` imports from
`./featureHandlerRegistrationText` and `./featureHandlerRegistrationTypes`,
both missing, so `tsc` would fail to compile on `main`, and
`check_feature_handler_registration.sh`'s `$CHECKER` would never exist —
`pre-merge-commit` refuses every future `--no-ff` merge into `main` once the
checked-out branch is `main` (its own fail-closed design, see the script),
which is exactly how QA lands every approved commit and how the coordinator/
specifier commit on `main`. Caught before any other role or the coordinator
touched `main` again.

## Repair

Restored the nine missing paths above verbatim from `ab8d10a8b3` (content
diffed byte-identical against files already on HEAD, e.g.
`featureHandlerRegistrationCheck.ts`, confirming no drift), added ONLY the
BL-1303 line to `index.js` (BL-1298's own line was correctly left out — that
ticket is still `paused/`, not shipped).

## Verification after repair

- `cd extension && npm run compile` — clean, no TS errors.
- `bash swarmforge/scripts/test/test_check_feature_handler_registration.sh` —
  `ALL PASS` (7/7).
- `node specs/pipeline/cli.js specs/features/BL-1303-a-feature-on-main-always-has-a-registered-handler.feature`
  — 7/7 pass (was 0/7 pass on the unrepaired replay tip).
- `specs/pipeline/scripts/run_acceptance.sh` on the same feature file — 7/7
  pass.
- Wiring anchors both reached: `grep check_feature_handler_registration
  swarmforge/scripts/run_commit_guards.sh swarmforge/git-hooks/pre-merge-commit`
  — both present.
- Confirmed the pre-existing, unrelated full-suite red (CURSOR_API_KEY
  missing in this environment; a `deps.checkOrphanedAuthoredDocs` naming
  mismatch in `pilotAcceptanceGate.ts`) predates this land: reproduced
  identically on `origin/main` at `5f00b1ccd6` (the commit immediately
  before BL-1303's replay landed), via a scratch `git worktree add --detach`,
  before removing that scratch worktree. Neither failing file was ever
  touched by any BL-1303 commit. Not this ticket's defect; not blocking.

## Land

Committed and pushed as a follow-up to `7110101164` via the same
`land_main_publish.sh` lock/decide/push discipline (BL-1144).
