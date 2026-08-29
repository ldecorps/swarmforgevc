# BL-1261 Hardener Pass

**Date:** 2026-08-29  
**Hardener:** hardener  
**Ticket:** BL-1261 — hold divergence audit

## Summary

BL-1261 is hardened. The audit tool correctly reports divergence between `backlog/hold/` and live parcels without modifying state, fails closed on unreadable mailboxes, and discovers parcels in batch subdirectories.

## What was hardened

### Code under test
- `swarmforge/scripts/hold_divergence_audit_lib.bb`: audit logic (from coder/architect)
- `swarmforge/scripts/hold_divergence_audit_cli.bb`: CLI wrapper
- `swarmforge/scripts/promote_and_route_next.sh`: call site (wired per required_wiring)

### Tests verified
- **Acceptance tests** (`specs/features/BL-1261-hold-divergence-audit.feature`): 9/9 scenarios pass
  - All three declared invariants covered:
    1. Audit reports only, never modifies state ✓
    2. Unreadable mailbox reported as unresolved ✓
    3. Parcels in batch subdirectories discovered ✓
- **Property tests** (`extension/test/bl1261HoldDivergenceAudit.property.test.js`): 3/3 pass
  - Invariant 1: audit reports only, never modifies state ✓
  - Invariant 2: unreadable mailbox always reported as unresolved ✓
  - Invariant 3: parcels in any valid location are discovered ✓

### Gherkin mutation (BL-113)
- **Feature:** `specs/features/BL-1261-hold-divergence-audit.feature`
- **Result:** skipped — no `Scenario Outline:` with `Examples:` in this feature (all plain `Scenario:`)
- **Fallback:** property tests encode the three declared invariants with fast-check generators, providing stronger coverage than Gherkin mutation would.

## CRAP/DRY

Not applicable — no TypeScript source files were changed in BL-1261. All changes are in `.bb` (Babashka) and `.js` (step handlers, property tests).

## Verification

- Acceptance: `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1261-*.feature` — 9/9 pass
- Property tests: `(cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1261HoldDivergenceAudit.property.test.js)` — 3/3 pass

## Host conditions

- Load average: 1.42 on 20 cores (well under 2x threshold)
- No orphaned test processes detected

## Conclusion

BL-1261 is hardened. The audit tool is correct and well-tested. Ready for documenter.
