# Architect Review Pass: BL-1262

**Reviewed commit**: f9d83176d5 (cleaner)
**Review date**: 2026-08-29
**Reviewer**: architect
**Verdict**: PASS — architecture compliant

## Summary

The cleaner correctly reverted the out-of-scope integration points added in the previous commit (f5e7e34958). The parcel now contains only the four files named by the ticket, with no modifications to front_desk_supervisor.bb or handoffd.bb.

## Changes verified

**Files restored** (as required by ticket):
- extension/src/metrics/selfHealTelemetry.ts (67 lines, matches BL-597 original)
- extension/src/metrics/selfHealTelemetryStore.ts (107 lines)
- swarmforge/scripts/self_heal_telemetry_cli.bb (50 lines)
- swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb (47 lines)

**Files unchanged** (per ticket constraints):
- swarmforge/scripts/front_desk_supervisor.bb: 654 lines, identical to pre-ticket state (commit 2195f1329)
- swarmforge/scripts/handoffd.bb: 4153 lines, identical to pre-ticket state

## Architecture checks

**Dependency gate**: PASSED (no forbidden edges in selfHealTelemetry.ts, selfHealTelemetryStore.ts)

**Co-change report**: The four restored files show high co-change frequency with each other (6 co-changes), which is expected since they were all restored together by this ticket. This is the correct coupling pattern for a file restoration.

**Module boundaries**: The restored files maintain the correct layering:
- TypeScript modules (selfHealTelemetry.ts, selfHealTelemetryStore.ts) are pure, testable policy
- Babashka CLI (self_heal_telemetry_cli.bb) loads the shared lib (self_heal_telemetry_lib.bb) which survives in the tree
- No browser storage, no VS Code API, no process spawning from TypeScript

## Test results

**Unit test**: PASSED (extension/test/selfHealTelemetry.test.js - 2 tests)

**Property test**: FAILED (extension/test/selfHealTelemetry.property.test.js)

The property test failure is a **separate defect** not owned by this ticket. The test's `invariant1 property` (line 72) checks that every KNOWN_EMIT_HOST loads the shared lib and calls append-self-heal-event!. The KNOWN_EMIT_HOSTS list includes front_desk_supervisor.bb, handoffd.bb, and handoff_lib.bb, but the integration points in those files were removed in a separate commit before the merge that dropped the four files. This ticket's constraints explicitly state "restores the four files it names and nothing else" - the integration points are not part of the restoration scope.

This is a pre-existing issue with the property test (written assuming integration points that no longer exist), not a defect in the parcel. It requires a separate ticket to either:
1. Restore the integration points (if they should exist)
2. Update the property test's KNOWN_EMIT_HOSTS list (if the integration points were intentionally removed)

## Declared invariants

BL-1262 declares two meta-invariants about repository state:
1. "A file that reaches main as part of an approved parcel is present at main until a commit deliberately removes it"
2. "No test file in the standing suite imports a module path that does not exist at the commit under test"

These invariants don't admit executable encoding as property tests on the selfHealTelemetry module - they're about repository hygiene and build integrity, not module behavior. They're enforced by CI/lint checks, not by property tests on the restored code.

## Conclusion

The parcel is architecturally compliant and ready for hardening. The property test failure is a separate defect requiring its own ticket, not a reason to bounce this parcel.
