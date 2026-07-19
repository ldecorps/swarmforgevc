# BL-520 QA Bounce Evidence - 2026-07-19

1. **Failing command**: `npm test`
2. **Commit hash**: `5581e4386b`
3. **First error excerpt**:

```text
> swarmforge-vc@0.1.0 test
> npm run compile && node scripts/recordTestDuration.js

> swarmforge-vc@0.1.0 compile
> tsc -p ./

> swarmforge-vc@0.1.0 postcompile
> node scripts/stampBuildSha.js

RUN  v3.2.6 /home/carillon/swarmforgevc/.worktrees/QA/extension

FAIL  test/paneTailerClass.test.js > poll reports a dead session and fires onDead once, then revives it
AssertionError: Expected values to be strictly equal:

0 !== 1

at test/paneTailerClass.test.js:102:12
```

4. **Failure class**: `unit`
5. **Expected vs observed**: expected the full extension unit suite to pass before QA approval; observed 10 failing tests across `paneTailerClass`, `paneTailerPollResilience`, `paneTailerScrollback`, `tmpDirMigrationGuard`, and `traceHopMain`.

Additional QA context:
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-520-rewrap-legacy-wrapped-steps.feature` passed all 4 BL-520 scenarios at `5581e4386b`.
- The failing extension test files are unchanged by the BL-520 diff relative to `master`, but QA's required full-suite gate is red, so the parcel cannot be approved.
