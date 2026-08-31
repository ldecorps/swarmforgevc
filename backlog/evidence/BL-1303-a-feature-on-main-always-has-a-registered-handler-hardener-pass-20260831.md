# BL-1303 hardener pass — 2026-08-31

Reviewed commit 98289aaf7c (architect repass, clean, no violations, forwarding
`8c83d7faf2`), merged into swarmforge-hardender.

## Checks re-run (all green)

- `bash swarmforge/scripts/test/test_pre_merge_commit_hook.sh`: 9/9 PASS.
- `bash swarmforge/scripts/test/test_run_commit_guards.sh`: 12/12 PASS.
- `bash swarmforge/scripts/test/test_check_feature_handler_registration.sh`:
  7/7 PASS (after `npm run compile` from `extension/` — `out/` is gitignored
  and does not survive a merge).
- `node specs/pipeline/cli.js specs/features/BL-1303-...feature`: 7/7 PASS.
- `npx vitest run --config vitest.properties.config.mjs
  bl632CommitTimeGuardInvariants`: 1/1 PASS.
- `npx vitest run --config vitest.properties.config.mjs
  bl1303FeatureHandlerRegistration`: 3/3 PASS.
- `test_pipeline_code_on_main_guard.sh`: all PASS except the pre-existing,
  out-of-scope "BL-925 invariant 2: handoffd.bb still runs its own inline
  ancestry git call" — confirmed `swarmforge/scripts/handoffd.bb` is
  byte-identical to `main` and untouched by this parcel (`git diff main --
  swarmforge/scripts/handoffd.bb` empty). Already surfaced upstream; not
  re-reported.
- `node extension/out/tools/dependency-gate.js`: PASSED, no forbidden edges.
- `npx jscpd` on the 5 touched TS files: 0 clones.

## CRAP — found and fixed a real gap

`node scripts/crapReport.js` on the 5 TS files this ticket touches
(`check-feature-handler-registration.ts`, `featureHandlerRegistrationCheck.ts`,
`featureHandlerRegistrationReport.ts`, `featureHandlerRegistrationText.ts`,
`featureHandlerRegistrationTypes.ts`) found two functions over the CRAP <= 6
threshold, plus a coverage gap of 4 uncovered branches:

- `assessFeatureHandlerRegistration`: complexity=13, coverage=89%, CRAP=13.22.
- `walkRegistry`: complexity=7, coverage=90%, CRAP=7.05.

(Standing reds unrelated to this parcel — `liveRepoDerivationGuard.test.js`
and 14 other pre-existing failing files, all previously documented across
BL-1240/BL-1244/BL-1253/BL-1280/BL-670/BL-1228/BL-1062/BL-1252 evidence —
block Vitest's default coverage write; re-ran with
`--coverage.reportOnFailure=true` per the accepted rule to get a real report,
none of the 15 failing files touch this ticket's code.)

Both functions are new in this parcel, so the absolute threshold applies
directly (not the differential-baseline gate, which is for pre-existing
grandfathered debt). Fixed with behavior-preserving extraction, the pattern
this role's own rules license for a CLI/CRAP trap:

- `walkRegistry`'s per-hop decision (dedup, existence, extension check) split
  into `visitRequiredModule` (complexity 4); `walkRegistry` itself now just
  drives the queue (complexity 4).
- `assessFeatureHandlerRegistration`'s two independent scans split into
  `collectUnregisteredHandlers` (complexity 6) and
  `collectMissingSiblingScripts` (complexity 5); the final dedup+sort split
  into `dedupeAndSortOffenders` (complexity 3). The orchestrator itself is now
  complexity 2.

Post-fix: every function in the 5 files is at or under CRAP 6
(`node scripts/crapReport.js` on all 5: 0 lines flagged `*** CRAP > 6 ***`).

Added 4 tests to close the coverage gap the CRAP run surfaced (the 4 branches
Stryker-equivalent hand mutation confirmed each one covers - see below):
diamond-dependency dedup, a non-.js required module, a feature file with no
ticket id in its name, and an unreadable handler when the registry itself is
unreadable.

## Non-vacuity — one test was wrong on the first pass, fixed and reverified

The first version of the dedup test (`a handler required by two other step
files is walked only once`) asserted only the empty offender list, which is
IDENTICAL whether or not the module is re-visited — hand-removing the
`seen.has(required)` guard left all 27 tests green. Rewrote it to assert a
`readFile` call count instead (the shared module read exactly once), moving
the shared module under `helpers/` so the sibling-script scan's own
legitimate read of every reachable top-level handler doesn't add a second,
unrelated read and mask the count. Reverified: with the guard removed, the
count reads 2 and the test fails.

All 4 new tests confirmed to fail against their own targeted hand-mutation of
the compiled+source, then confirmed to pass again once reverted:
- dedup guard removed → shared module read twice, not once. FAILS as
  expected.
- `!required.endsWith('.js')` check removed → the non-.js fixture's own text
  (a require-shaped reference in single quotes, chosen so it survives
  `withoutEmbeddedSource`'s double-quote/backtick blanking) gets traversed
  and reports a phantom `missing-registry-module` offender. FAILS as
  expected.
- `if (!ticketId) continue` removed → `handlerDeclaresTicket` is called with
  `undefined`, throwing. FAILS as expected.
- `if (text === null) { ...; continue; }` removed in the sibling-script scan
  → `extractSiblingScripts` is called with `null`, throwing. FAILS as
  expected.

Mutation testing via Stryker itself could not run at all here (unrelated
standing red `liveRepoDerivationGuard.test.js` and others fail Stryker's
all-or-nothing dry run precondition) — the hand-mutation above is this
role's own documented fallback for exactly that condition.

## Disposition

Forward to documenter.
