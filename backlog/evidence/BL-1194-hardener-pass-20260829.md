# BL-1194 Hardener Pass

**Date:** 2026-08-29  
**Hardener:** hardener  
**Ticket:** BL-1194 — hygiene gate duplicate-id check self-duplicate false positive

## Summary

Fixed a vacuous property test that was passing ~80% of the time because both sides of the assertion failed (exit code 2: file not found), not because both sides succeeded. The fix makes the test meaningful by correctly setting the working directory for the relative-path invocation.

## What was hardened

### Code under test
- `swarmforge/scripts/backlog_hygiene_lib.bb`: `backlog-relative` normalizer and `other-holders` fix (from coder/architect)

### Tests added/fixed
- **Property test fix** (`extension/test/bl1194HygieneGateSelfDuplicate.property.test.js`):
  - `runGate()` now accepts and passes `cwd` parameter
  - Invariant 1 test computes relative path from fixture root's parent (matching acceptance step handler pattern)
  - Invariant 2 test passes cwd to runGate
  - **Result:** 20/20 passes (was 16/20 before fix, ~20% flaky failure rate)

### Gherkin mutation (BL-113)
- **Feature:** `specs/features/BL-1194-hygiene-gate-relative-path-self-duplicate-false-positive.feature`
- **Result:** 2/2 mutants killed
  - m1: `relative` → `relaTive` (killed by KNOWN_VALUES validation in step handler)
  - m2: `absolute` → `absoluTe` (killed by KNOWN_VALUES validation in step handler)
- **Manifest:** written to feature file (sha256=af297c78942ef4b9ff845dc4fd1f54ba73ec4376ae01cac4cf24a0f82f594136)

### Acceptance tests
- **Result:** 5/5 scenarios pass
  - Scenario 01: new ticket, relative path, no duplicate ✓
  - Scenario 02: genuine duplicate, both path forms, still caught ✓
  - Scenario 03: published self, relative path, not a duplicate ✓
  - Scenario 04: published different file, still caught ✓

### Unit tests
- **Result:** all pass (including 10 new BL-1194 tests in `backlog_hygiene_lib_test_runner.bb`)

## Defect found and fixed

**The property test was vacuous.** The invariant 1 property (path-form independence) was flaky because `runGate()` did not set the `cwd` parameter when invoking the gate CLI. Without `cwd`, the relative path `backlog/paused/BL-0-test-slug.yaml` resolved against vitest's working directory (`extension/`), not the fixture root's parent. The gate then failed with "no such file" (exit 2) for the relative path, while the absolute path succeeded (exit 0).

The test asserted `relResult.status === absResult.status`, which failed when one was 0 and the other was 2. But 80% of the time, both failed with exit 2 (because the file didn't exist at either path), so the assertion passed vacuously.

Fast-check's shrinker found `BL-0` as the minimal counterexample. The fix sets `cwd` to `path.dirname(fixture.root)` for both invocations and computes the relative path from that cwd, matching the acceptance step handler's pattern.

**This is a test harness defect, not a production code defect.** The production code (`backlog_hygiene_lib.bb`) correctly normalizes paths. The property test's own fixture setup was wrong.

## CRAP/DRY

Not applicable — no TypeScript source files were changed in BL-1194. All changes are in `.bb` (Babashka) and `.js` (step handlers, property tests).

## Verification

- Unit tests: `bb swarmforge/scripts/test/backlog_hygiene_lib_test_runner.bb` — all pass
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1194-*.feature` — 5/5 pass
- Gherkin mutation: `specs/pipeline/scripts/run_gherkin_mutation.sh ... soft` — 2/2 killed
- Property tests: `(cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1194HygieneGateSelfDuplicate.property.test.js)` — 20/20 pass (ran 20x in a loop to verify stability)

## Host conditions

- Load average: 1.42 on 20 cores (well under 2x threshold)
- No orphaned test processes detected
- Mutation cooldown gate: not applicable (no `.ts` source changed)

## Conclusion

BL-1194 is hardened. The fix in `backlog_hygiene_lib.bb` is correct and well-tested. The property test is now meaningful (no longer vacuous). Ready for documenter.
