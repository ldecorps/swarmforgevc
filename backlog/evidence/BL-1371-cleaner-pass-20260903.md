# BL-1371 — cleaner pass, 2026-09-03 (expedite run, stage 02)

No code change made. The coder's discovery implementation
(`specs/pipeline/steps/index.js`) already meets this stage's checklist:
small single-purpose functions (`discoverHandlerFiles`, `loadHandler`,
`loadHandlers`, `registerLoadedHandlers`), one caller each, narrow
interfaces, high-level `registerSteps` kept free of the filesystem/require
mechanics it now delegates to. Per the coder's own handoff note, did not
collapse `registerLoadedHandlers` back into `registerSteps` — both
`bl1371StepDiscoverySteps.js` and the property tests need to register a
list they loaded themselves.

## Checks run this pass

| Check | Result |
|---|---|
| `npm run compile` (from `extension/`) | clean |
| `npx vitest run` — `bl1371StepDiscovery.test.js`, `featureHandlerRegistrationCheck.test.js`, `checkFeatureHandlerRegistrationCli.test.js` | 45 pass |
| `npx vitest run --config vitest.properties.config.mjs` — `bl1371StepDiscoveryInvariants.property.test.js`, `bl1303FeatureHandlerRegistration.property.test.js` | 6 pass, same reach floors the coder reported |
| `swarmforge/scripts/test/test_check_feature_handler_registration.sh` | ALL PASS (9 cases) |
| `node out/tools/check-feature-handler-registration.js <repo>` | exit 0 |
| `run_acceptance.sh` BL-1371 feature | 5/5 pass |
| `run_acceptance.sh` BL-1303 feature | 7/7 pass |
| `run_acceptance.sh` BL-968 feature | 3/4 pass — identical to the coder's reported baseline (scenario 3 is a pre-existing, unrelated QA-bound-gate red) |
| Mutation-site count (BL-485), compiled `out/`: `featureHandlerRegistrationCheck.js` | 130 sites, `over` the 100 threshold — but **pre-existing**: rebuilt the file at `main`'s revision and it was already 109 sites before this parcel's +21. Not a split candidate for this ticket — the added surface is one branch (`isDiscovered`), and a mechanical chop of an already-cohesive assessor module would not improve structure per this stage's own rule against line-count-only splits. |
| Mutation-site count: `featureHandlerRegistrationTypes.js` | 5 sites, within |
| `jscpd` over the touched files | 1 clone, 15 lines / 59 tokens, between `bl1371StepDiscovery.test.js` and `bl1371StepDiscoveryInvariants.property.test.js` fixture setup — unit and property tests are required to stay separate (own tag/command, never folded together), so a shared helper here would cross that boundary for a trivial saving. Left as written. |
| `node scripts/crapReport.js src/tools/featureHandlerRegistrationCheck.ts src/tools/featureHandlerRegistrationTypes.ts` (scoped coverage) | every function CRAP ≤ 6.00 (max: `collectUnregisteredHandlers` at 6.00, exactly at the ceiling, 100% covered) |
| `git diff main --stat` | unchanged from the coder's commit — this stage added no commit |

## Verdict

Forwarding to architect unchanged (no functional or structural change from
this stage) — the received commit already satisfies the cleaner's
checklist, so committing a no-op diff would violate the No-Op Rule.
