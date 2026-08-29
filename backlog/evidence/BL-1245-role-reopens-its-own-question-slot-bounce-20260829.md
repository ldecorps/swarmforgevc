# BL-1245 Architect Bounce — 2026-08-29

## Ticket
BL-1245: role-reopens-its-own-question-slot

## Commit Reviewed
dde6b7f686 (cleaner pass)

## Violation: Missing Property Tests for Declared Invariants

The ticket YAML declares three invariants under `invariants:`:

1. "A role can always reopen its own pending slot: no state of the awaiting marker leaves the asking role with no action available."
2. "Reopening never destroys the question - its text, its asked_at_ms, and the reason given remain readable afterwards."
3. "A preserved record is never read back as live state: the only question the guard treats as pending is one actually raised and not yet resolved."

### Defect
The parcel carries **no property tests** encoding these invariants, and provides **no stated reason** for non-encodability. The invariants ARE encodable:

- The codebase has established precedent for property-testing bb scripts via TypeScript wrappers (see `bl1030RefusalCostsNothing.property.test.js` wrapping `expedite_cli.bb`, `bl1071SweepSurvivesAnyProbeFailure.property.test.js`, `availabilityLedgerReaderTolerance.property.test.js` wrapping `bl823_fold_acceptance_runner.bb`).
- The resolve logic is pure filesystem state transformation, testable via fast-check generators over role names, question text, asked_at_ms timestamps, and reason strings.
- Each invariant maps to a property:
  - **Invariant 1**: For any role state, `role_ask.bb --resolve --reason <any-reason>` always exits with the slot freed (no .json in role-awaiting/).
  - **Invariant 2**: For any question/timestamp/reason triple, after resolve, the archive file at `role-awaiting-archive/<role>-<timestamp>.json` contains all three fields plus resolved_at.
  - **Invariant 3**: For any resolved question, no .json file in `role-awaiting/` contains the question text or the asked_at_ms.

### Why This Is a Hard Gate
Per architect role instructions (Invariants Review section):

> "If the ticket YAML declares `invariants:`, FIRST check, for each declared invariant, whether the parcel carries an executable property test encoding it — or, where the invariant admits no executable encoding, a stated non-encodability reason — before any hand-verification of the property itself. A missing or vacuous property test is itself a send-back."

The shell tests (`test_role_ask.sh`) are example-based and verify specific scenarios, but they do not encode the invariants as quantified properties over the full input space. The invariants state "always" and "never" — these are universal quantifiers that property tests assert, not examples.

### Remediation
Add a property test file `extension/test/bl1245RoleReopensOwnSlot.property.test.js` that:

1. Wraps the `role_ask.bb` CLI via `execFileSync` (same pattern as `bl1030RefusalCostsNothing.property.test.js`).
2. Encodes each of the three invariants as a separate property using fast-check:
   - `fc.property(fc.string(), fc.string(), fc.integer(), fc.string(), ...)` for Invariant 1
   - `fc.property(fc.string(), fc.string(), fc.integer(), fc.string(), ...)` for Invariant 2
   - `fc.property(fc.string(), fc.string(), fc.integer(), fc.string(), ...)` for Invariant 3
3. Each property must be **non-vacuous**: demonstrate it FAILS when the invariant is deliberately broken (e.g., if the archive write is removed, Invariant 2's property must fail).
4. Run via `npm run test:properties` and confirm green before re-forwarding.

### Verification
The shell tests pass (all 14 scenarios green), but passing shell tests do not satisfy the invariant-encoding requirement. The property tests must exist and be runnable via the standard property-test command.

## Blame
- **Role**: coder (the property tests are the coder's responsibility per coder.prompt's Invariants section)
- **Class**: invariant-unencoded (distinct from behavior for a violated property)
