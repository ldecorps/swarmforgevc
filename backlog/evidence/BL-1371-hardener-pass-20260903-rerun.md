# BL-1371 — hardener re-run, 2026-09-03 (expedite re-run, stage 04)

The first expedite run passed all six stage verdicts and failed on its ticket
half (`run.json`: failed-half=ticket, exit code 1). This is the re-run's
hardener stage, re-verified against the branch tip (`deece4d965`, architect
re-run) rather than trusting the original pass (`e1e07c364e`).

`git diff e1e07c364e..HEAD --stat` over `extension/src/**` and
`specs/pipeline/steps/**` is empty: production and test code are byte-identical
to this stage's own original commit. The only changes since are the
documenter's original doc pass, the specifier's re-run note (two-copy
`required_wiring` land hazard, bookkeeping not code), the coder re-run note,
the cleaner re-run note, and the architect re-run note — none of them touch
anything this stage's mutation work covers. Every check below was re-run from
scratch rather than quoted.

Load quiet throughout (`uptime` 0.20–0.90 on 20 cores); no leftover
`node --test`/`stryker` processes before or after this pass.

## Checks run this pass

| Check | Result |
|---|---|
| `npx vitest run` — `bl1371StepDiscovery.test.js`, `featureHandlerRegistrationCheck.test.js`, `checkFeatureHandlerRegistrationCli.test.js` | 46/46 pass, unchanged |
| `npx vitest run --config vitest.properties.config.mjs` — `bl1371StepDiscoveryInvariants.property.test.js`, `bl1303FeatureHandlerRegistration.property.test.js` | 6/6 pass; reach floors met (P1 120, P2 120, P3 120) |
| `node scripts/crapReport.js` (scoped to the two touched `src/*.ts`) | every function CRAP ≤ 6.00, 100% coverage, `isDiscovered` at 4.00 — unchanged |
| `swarmforge/scripts/test/test_check_feature_handler_registration.sh` | 9/9 PASS |
| `specs/pipeline/scripts/run_acceptance.sh` BL-1371 feature | 5/5 pass |
| `node extension/out/tools/check-feature-handler-registration.js .` | exit 0 |
| `jscpd` over the two touched TS files | 0 clones |
| Orphaned `node --test`/`stryker` processes | none before or after |

## Mutation gaps (re-confirmed closed, not re-derived)

The two real Stryker survivors this stage found and closed last pass (the new
`isDiscovered` guard's `ConditionalExpression`/`LogicalOperator` mutants) are
covered by the isolating unit test added in the original pass
(`featureHandlerRegistrationCheck.test.js`: "a *Steps.js file nested one level
under steps/ is not auto-discovered") — present at tip, part of the 46/46
above, and its target production code is byte-identical to when it was
verified killing both mutants. Not re-run through Stryker this pass (no
production diff since the original run to justify repaying that cost); the
unit test itself re-passing is the re-verification that the fix is still in
place. The `featureHandlerRegistrationTypes.js` false-reading survivors
(REGISTRY_PATH/STEPS_DIR/LIB_DIR/FEATURES_DIR) were already confirmed
tooling artifacts by direct hand-mutation last pass; that file is also
byte-identical at tip.

Gherkin mutation stays inapplicable (BL-638, no `Scenario Outline:` in the
feature — unchanged). The hand-authored sweep on
`bl1371StepDiscoverySteps.js`'s comment-stripping regex is unchanged
production code, already verified caught by acceptance last pass.

## Verdict

PASS. No production or test change since the original hardener pass; every
check re-run from scratch against the branch tip agrees with the original
numbers. Forwarding to documenter for the re-run's documenter stage.
