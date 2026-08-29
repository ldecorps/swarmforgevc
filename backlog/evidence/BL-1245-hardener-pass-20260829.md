# BL-1245 Hardener Pass

**Date:** 2026-08-29  
**Hardener:** hardener  
**Ticket:** BL-1245 — role reopens its own pending question slot

## Summary

BL-1245 is hardened. The fix in `role_ask.bb` allows a role to reopen its own pending question slot with a recorded reason, preserving the question text and timestamp in `role-awaiting-archive/` where the pending-guard cannot read it back as live state.

## What was hardened

### Code under test
- `swarmforge/scripts/role_ask.bb`: added `resolve` subcommand with `--reason` flag (from coder/architect)

### Tests verified
- **Unit tests** (`swarmforge/scripts/test/test_role_ask.sh`): all pass (14 scenarios including BL-1245-specific tests)
- **Acceptance tests** (`specs/features/BL-1245-role-reopens-its-own-question-slot.feature`): 6/6 scenarios pass
  - Scenario 01: role can reopen its own pending slot with a reason ✓
  - Scenario 02: resolve without a reason is refused ✓
  - Scenario 03: resolve when nothing is pending reports nothing-pending ✓
  - Scenario 04: resolve preserves the question in role-awaiting-archive/ ✓
  - Scenario 05: role-awaiting/ holds no .json after resolve ✓
  - Scenario 06: preserved evidence is never read back as a pending question ✓
- **Property tests** (`extension/test/bl1245RoleReopensOwnSlot.property.test.js`): 3/3 pass
  - Invariant 1: a role can always reopen its own pending slot ✓
  - Invariant 2: reopening never destroys the question ✓
  - Invariant 3: a preserved record is never read back as live state ✓

### Gherkin mutation (BL-113)
- **Feature:** `specs/features/BL-1245-role-reopens-its-own-question-slot.feature`
- **Result:** skipped — no `Scenario Outline:` with `Examples:` in this feature (all plain `Scenario:`)
- **Fallback:** hand-authored mutation sweep not warranted — the property tests already encode the three declared invariants with fast-check generators over role names, reasons, and question text. The acceptance tests cover the CLI surface comprehensively.

## CRAP/DRY

Not applicable — no TypeScript source files were changed in BL-1245. All changes are in `.bb` (Babashka) and `.js` (step handlers, property tests).

## Verification

- Unit tests: `bash swarmforge/scripts/test/test_role_ask.sh` — all pass
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1245-*.feature` — 6/6 pass
- Property tests: `(cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1245RoleReopensOwnSlot.property.test.js)` — 3/3 pass

## Host conditions

- Load average: 1.42 on 20 cores (well under 2x threshold)
- No orphaned test processes detected
- Mutation cooldown gate: not applicable (no `.ts` source changed)

## Conclusion

BL-1245 is hardened. The fix is correct and well-tested across unit, acceptance, and property lanes. Ready for documenter.
