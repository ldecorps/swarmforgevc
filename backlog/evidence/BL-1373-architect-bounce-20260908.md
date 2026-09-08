# BL-1373 Architect Bounce — 2026-09-08

## D1: Missing property tests for declared invariants

**Failure class**: invariant-unencoded

**Violated rule**: The ticket declares two invariants in the YAML:
1. "The classified path set is whatever BL-632's single source reports at runtime, including a set the sweep has never seen before - never a value fixed at any earlier moment."
2. "A path the single source does not report produces no finding, so widening the set is never achieved by classifying everything."

Per the architect role prompt's Invariants Review section, when a ticket declares invariants, the parcel must carry executable property tests encoding them — or a stated non-encodability reason. No property tests exist for BL-1373, and no non-encodability reason was stated in the coder's diagnosis or the cleaner's evidence.

**Why this matters**: The acceptance scenarios (BL-631 scenario 07 and BL-1373's own scenarios) test specific examples, but they do not test the "for all" properties stated in the invariants. A property test would verify that the cache invalidation holds for any path set, not just the stub paths in the examples.

**Commit reviewed**: 5e0aa58184 (cleaner's forward of the coder's work)

**Remediation**: Write property tests in `extension/test/bl1373PathSetCacheInvariants.property.test.js` (or similar) that verify:
- Invariant 1: For all path sets P1, P2 where P1 ≠ P2, if the cache is populated with P1, then a sweep with P2 must re-evaluate (not return a cached result).
- Invariant 2: For all path sets P, for all paths X where X ∉ P, a commit touching only X produces no finding.

Use fast-check (the project's pinned property-testing framework) and drive the real `babysitter_check.bb` via `execFileSync` (other property tests in this project do the same).

**Blamed role**: coder (per architect role prompt: "You are never the first author of a declared invariant's property test — that authorship rests with the coder")

**Architect's correctness read**: The fix itself (including `qa-paths` in the cache key at `babysitter_check.bb:680`) is correct and architecturally sound. The root cause diagnosis is accurate. The only defect is the missing property tests.

By architect.
