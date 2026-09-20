# Unowned red: bl1630NoStepHandlerModuleLoadWorkInvariants.property.test.js timing flake under contention

Found while verifying BL-1662 (unrelated: BL-1662 touches only
`check_merge_deletion.sh`, BL-1242's feature/handler, and the fixture
CLI). Not touched by BL-1662's diff.

## Failure

Full-lane run: `assert.deepEqual(violations, [])` failed — the census
reported one fixture handler (`zzzNonVacuityOffenderSteps.js`) over its
200ms require-cost budget: `incremental require cost 214.0ms exceeds the
200ms budget (confirmed alone)`.

Re-run in isolation (`npx vitest run --config vitest.properties.config.mjs
test/bl1630NoStepHandlerModuleLoadWorkInvariants.property.test.js`):
passed clean, 2/2, 1.68s.

## Disposition

A narrow-margin timing budget (214ms vs 200ms, ~7% over) tripped under
full-lane fork contention, not deterministic — matches the known BL-1633
contention-class shape already documented elsewhere this shift (a
per-file/per-fixture duration budget read IN-SUITE under load can exceed
a budget that holds comfortably alone). No standing-red register row or
ticket exists for this specific test file (grepped before writing this).
Not blocking BL-1662. Reporting for the specifier's own judgment —
recommend either a wider budget margin or the same solo-confirmation
discipline BL-1633 already established elsewhere.

By QA.
