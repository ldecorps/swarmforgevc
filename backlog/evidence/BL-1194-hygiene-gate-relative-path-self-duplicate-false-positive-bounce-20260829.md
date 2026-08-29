# BL-1194 Architect Bounce — 2026-08-29

## Ticket
BL-1194: hygiene-gate-relative-path-self-duplicate-false-positive

## Commit Reviewed
a7d885dbde (cleaner pass)

## Violation: Missing Property Tests for Declared Invariants

The ticket YAML declares two invariants under `invariants:`:

1. "The duplicate-id check's verdict for a single ticket file is identical whether the gate is invoked with a path relative to the working directory or an absolute path."
2. "A ticket already published under its own id at the invoked path is never counted as an 'other holder' of that id — only a genuinely different file is."

### Defect
The parcel carries **no property tests** encoding these invariants, and provides **no stated reason** for non-encodability. The invariants ARE encodable:

- The codebase has established precedent for property-testing bb scripts via TypeScript wrappers (see `bl1030RefusalCostsNothing.property.test.js` wrapping `expedite_cli.bb`, `bl1071SweepSurvivesAnyProbeFailure.property.test.js`).
- The `backlog-relative` normalization function and the `other-holders` set logic are pure and testable via fast-check generators over path strings, ticket ids, and corpus states.
- Each invariant maps to a property:
  - **Invariant 1**: For any path string `p`, running the gate on `p` produces the same verdict as running it on `(absolute-path p)`.
  - **Invariant 2**: For any ticket id and any corpus state where that id exists at path `p` both locally and in published, `other-holders` for `(id, p)` does not include `p` in its result.

### Why This Is a Hard Gate
Per architect role instructions (Invariants Review section):

> "If the ticket YAML declares `invariants:`, FIRST check, for each declared invariant, whether the parcel carries an executable property test encoding it — or, where the invariant admits no executable encoding, a stated non-encodability reason — before any hand-verification of the property itself. A missing or vacuous property test is itself a send-back."

The bb tests (`backlog_hygiene_lib_test_runner.bb`) are example-based and verify specific scenarios, but they do not encode the invariants as quantified properties over the full input space. The invariants state "identical" (for all paths) and "never counted" (for all published copies) — these are universal quantifiers that property tests assert, not examples.

### Remediation
Add a property test file `extension/test/bl1194HygieneGateSelfDuplicate.property.test.js` that:

1. Wraps the `specifier_backlog_hygiene_gate.bb` CLI via `spawnSync` (same pattern as the acceptance step handlers in `bl1194HygieneGateSelfDuplicateSteps.js`).
2. Encodes each of the two invariants as a separate property using fast-check:
   - **Invariant 1**: `fc.property(fc.string(), fc.string(), ...)` — for any id and path form, the verdict is identical.
   - **Invariant 2**: `fc.property(fc.string(), fc.string(), ...)` — for any id and corpus state, the subject's own published copy is never in `other-holders`.
3. Each property must be **non-vacuous**: demonstrate it FAILS when the invariant is deliberately broken (e.g., if `backlog-relative` is removed, Invariant 1's property must fail).
4. Run via `npm run test:properties` and confirm green before re-forwarding.

### Verification
The bb tests pass (all 40 scenarios green), but passing bb tests do not satisfy the invariant-encoding requirement. The property tests must exist and be runnable via the standard property-test command.

## Blame
- **Role**: coder (the property tests are the coder's responsibility per coder.prompt's Invariants section)
- **Class**: invariant-unencoded (distinct from behavior for a violated property)
