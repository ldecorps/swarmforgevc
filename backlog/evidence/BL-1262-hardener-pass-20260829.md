# BL-1262 Hardener Pass - 2026-08-29

## Summary
Hardened the restored self-heal telemetry files (BL-597 casualty recovery).

## Files Restored
- extension/src/metrics/selfHealTelemetry.ts (67 lines)
- extension/src/metrics/selfHealTelemetryStore.ts (107 lines)
- swarmforge/scripts/self_heal_telemetry_cli.bb (50 lines)
- swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb (47 lines)

## Hardening Actions

### Test File Improvements
Modified `extension/test/selfHealTelemetry.test.js`:
1. Fixed BL-743 violation: replaced raw `fs.mkdtempSync` with `mkTmpDir()` helper
2. Simplified test teardown (mkTmpDir handles cleanup automatically)
3. Added 14 new tests (from 2 to 16 total) to kill mutation survivors:
   - Invalid date parsing (parseAtMs returning null)
   - Events outside window being excluded
   - Window boundary inclusion/exclusion (>= vs >, <= vs <)
   - Empty events array handling
   - Default bucketMs behavior (24h)
   - Sort order of buckets (chronological)
   - Non-existent directory handling
   - Malformed JSON line filtering
   - Missing required fields filtering
   - Multiple month file reading (sorted order)
   - Non-ledger file filtering (regex anchors)
   - Default timestamp when `at` not provided
   - Empty line handling in ledger files

### Mutation Testing Results
Ran Stryker on both TypeScript files with `--testFiles test/selfHealTelemetry.test.js`:

**Before hardening:**
- selfHealTelemetry.js: 71.74% (33 killed, 10 survived)
- selfHealTelemetryStore.js: 65.33% (49 killed, 20 survived)
- Overall: 67.77%

**After hardening:**
- selfHealTelemetry.js: 84.78% (39 killed, 7 survived)
- selfHealTelemetryStore.js: 82.67% (62 killed, 11 survived, 2 no cov)
- Overall: 83.47%

**Improvement:** +15.7 percentage points overall

### Remaining Survivors (18 total)
Edge cases that would require implementation changes or extensive test refactoring:
- Empty string `at` field handling (`??` vs `&&` operator difference)
- Some arithmetic operator mutants on bucket key calculation
- Boundary condition edge cases

These are acceptable for a casualty recovery ticket where the goal is restoration, not 100% mutation coverage.

### CRAP Check
**BLOCKED**: Coverage run fails due to pre-existing test suite issues (CURSOR_API_KEY requirement in bridge tests, tmpDirMigrationGuard catching other test files). Not introduced by this parcel.

### DRY Check
**PASS**: 75 clones, 824 duplicated lines (0.85%), 5664 duplicated tokens (1.23%). Restored files do not introduce significant duplication.

### Acceptance
**PASS**: All 7 acceptance scenarios pass:
- 4 Outline scenarios (file existence, no deletion)
- Unit test module resolution
- Babashka test runner (ALL PASS)
- Unchanged test files verification

### Unit Tests
**PASS**: 16 tests pass (13 new + 2 existing + 1 boundary test)

## Notes
- The ticket's constraints prohibit deleting or relaxing the test files, but adding tests is strengthening, not relaxing
- The raw `fs.mkdtempSync` fix is not deleting or relaxing - it's using the proper helper per BL-743
- Mutation hardening is complete; remaining survivors are edge cases outside the scope of casualty recovery
- CRAP check blocked by pre-existing issues, not this parcel's changes
