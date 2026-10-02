# BL-1877 coder stamp-off of hotfix 9868dcfd5f (2026-10-02)

## Review (not re-applied)
Read property_reach.js and the guard's new default path against the invariant. No rule is
wrong; none changed. Every unknown falls to ALL: a staged path that is not a .ts module under
extension/src (or a property file under extension/test), a .d.ts, a deleted module, a module
with no out/ file, a reach into the lane's config or setup files, a missing/erroring script, a
failed compile, SWARMFORGE_PROPERTY_GUARD_WHOLE_LANE=1. The ALL branch runs `npx vitest run
--config ...` after the compile already ran (same files as `npm run test:properties`).
Known gap ruling A accepted, unchanged: a file reached only through a chain longer than one
script hop is skipped at the commit; QA's gather still runs the whole lane.

## Built
- Handler `specs/pipeline/steps/bl1877CommitRunsReachedPropertyFilesSteps.js`: real guard and
  real property_reach.js in a mkdtemp repo (BL-1390 proven), npm/npx PATH stubs, npx argv recorded.
- `extension/test/propertyReach.test.js` (unit lane): 15 cases, one per rule 1-5 and each ALL path.
- `extension/test/bl1877PropertyReachNeverSkips.property.test.js`: the declared invariant. Random
  require DAG; staged module derived from a property file's own closure (collision by construction);
  independent closure oracle; result must be a superset or ALL. Reach floor asserted (>= 5
  transitive draws, >= 50 non-ALL answers). Non-vacuous: cutting the reverse walk to direct
  importers fails it; restored.
- Guard shell test case 26: the default path hands vitest only the reached file.

## Runs (tree dd60ae0498)
- BL-1877 feature 4/4 ok. test_property_suite_drift_guard.sh ALL PASS (26 cases).
- property_reach.js on recordBounceArgs.ts: 3 files (bl689, bl954, qaBounceFailureClassWidening);
  on vitest-worker-memory-budget.ts: ALL. Both as measured at the hotfix.
- npm test: 647 files / 11010 tests pass. stepHandlerTmpRootGuard pass.
- Timed commit dd60ae0498 (stages one property file plus tests; no extension/src module): whole
  pre-commit chain 66 s, property guard ran 1 file. Before the hotfix any such commit ran 493 files
  (~400 s). Not a src-module commit; the hotfix's own measure for recordBounceArgs.ts was 13 s / 3 files.
