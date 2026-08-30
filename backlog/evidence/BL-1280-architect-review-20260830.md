# BL-1280 — architect review

Architect, 2026-08-30. Reviewed cleaner's merge of coder's `8e1c58d318`
(cleaner made no further changes, no separate cleaner-pass evidence file this
time — merge only).

## Checks run, all clean

- `node extension/out/tools/dependency-gate.js` (full-repo AND the parcel's
  own changed test files) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` against the parcel's changed
  files — every flagged pair is within the same pre-existing tmpDir/BL-420/
  BL-714/BL-1209 subsystem; no unexpected coupling.
- Invariants Review (BL-633/654): both declared invariants have a live,
  non-vacuous property test (`bl1280MkdtempMigrationInvariants.property.test.js`).
  Re-ran `npm run test:properties -- bl1280`: 6/6. Invariant 1 is exhaustive
  over the real 33-site corpus plus a construction-guaranteed sensitivity
  draw over both too-long-lived positions; invariant 2 asserts the exempt
  list AND the two data-carrier fixtures together (exempting either one
  trivially would defeat the other). Both invariants have documented
  break-then-restore non-vacuity runs; spot-verified by reading the property
  file directly rather than trusting the evidence prose alone.
- Re-ran the coder/cleaner's headline claims directly:
  - `npx vitest run test/tmpDirMigrationGuard.test.js test/pilotMkdtempConventionCheck.test.js`:
    11/11 + 9/9 (was 1 failed/10 passed for the migration guard).
  - `npm run test:properties -- bl1280`: 6/6.
  - `node specs/pipeline/cli.js specs/features/BL-1280-...feature`: 4/4.
  - Full `vitest run --config vitest.config.mjs`: **26 failed files / 218
    failed tests / 9436 passed**, exactly the claimed "27→26 files, 219→218
    tests" (only `tmpDirMigrationGuard.test.js` left the red set). Diffed the
    full FAIL list against every file this parcel touched: none of the 26
    remaining red files is one this parcel edited except
    `pilotScopedCrapCheck.test.js` (2 failures, matching the coder's own
    "2 fail before and after" claim) and `operatorRuntimeBbFixtureClosure.test.js`
    (2 failures, the pre-existing BL-1279-adjacent red, untouched by this
    parcel). No regression.
- Spot-checked the migration mechanics directly:
  - `extension/test/agentNotesCore.test.js`: five `fs.mkdtempSync(path.join(os.tmpdir(), 'PREFIX-'))`
    sites replaced 1:1 with `mkTmpDir('PREFIX-')`, prefix strings byte-identical,
    `os` import dropped only where no longer used.
  - `extension/test/helpers/rawMkdtempGuard.js`: exempt list back to the
    three documented paths; the two BL-1209 pilot-file exemptions removed.
    The ENOENT skip in `findRawMkdtempCallSites` is scoped to exactly
    `err.code === 'ENOENT'` — any other error still throws, so this does not
    quietly widen into a general error swallow.
  - `extension/test/pilotMkdtempConventionCheck.test.js` /
    `.property.test.js`: the fixture literal split as
    `"const dir = fs.mkdtemp" + "Sync(...)"` — string concatenation, so the
    bytes written to disk via `fixtureRootWith` are unchanged (verified: the
    invariant-2 property folds the concatenation back and re-asserts the
    detector still trips on it).
- Lifecycle audit (invariant 1's substance): confirmed by reading
  `classifyCallSite`'s reach-floor test and the exhaustive-corpus test
  together — 0 of the 33 real sites classify as `beforeAll` or module scope;
  the one `beforeEach` site is not in the too-long-lived set (correctly:
  `beforeEach` reruns before every test, so `mkTmpDir`'s `afterEach` sweep
  never outlives it).
- Architecture: no layering concern. The guard (`rawMkdtempGuard.js`) is a
  pure, testable module; the migration itself is mechanical test-code churn
  with no `extension/src` involvement, so CRAP/mutation/DRY gates don't apply
  (same basis as the three prior BL-1274/1277/1279 cleaner passes this
  shift).

No defect found. Forwarding to hardener.
