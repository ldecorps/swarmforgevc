# Architect Bounce: BL-1262-restore-self-heal-telemetry-files-dropped-by-a-merge

**Reviewed commit**: f5e7e34958 (cleaner)
**Review date**: 2026-08-29
**Reviewer**: architect
**Verdict**: BOUNCE — scope violation

## Defect

The cleaner added integration points to `swarmforge/scripts/front_desk_supervisor.bb` and `swarmforge/scripts/handoffd.bb` that are **out of scope** for this ticket.

### Ticket constraints (verbatim)

> "This ticket restores the four files it names and nothing else. It does not change what the telemetry measures, add a metric, alter the trend computation, or touch self_heal_telemetry_lib.bb's contents."

The four files named by the ticket are:
1. `extension/src/metrics/selfHealTelemetry.ts`
2. `extension/src/metrics/selfHealTelemetryStore.ts`
3. `swarmforge/scripts/self_heal_telemetry_cli.bb`
4. `swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb`

The cleaner modified **two additional files** (front_desk_supervisor.bb and handoffd.bb) to add `load-file` and `append-self-heal-event!` calls. This violates the ticket's scope.

### Why the cleaner did this

The cleaner's commit message says "Fixes QA bounce D1 (property tests fail - integration points not restored)". The property test `extension/test/selfHealTelemetry.property.test.js` has a `KNOWN_EMIT_HOSTS` list that includes front_desk_supervisor.bb, handoffd.bb, and handoff_lib.bb, and checks that each loads the shared lib and calls `append-self-heal-event!`.

However:
1. The property test was added **after** BL-597 (it doesn't exist at commit a01027aa6)
2. The integration points in front_desk_supervisor.bb were removed **before** the merge that dropped the four files (they're absent at commit 8562094f8, the last commit before the drop)
3. The cleaner added integration to only 2 of 3 .bb hosts (front_desk_supervisor.bb and handoffd.bb but not handoff_lib.bb), so the property test **still fails**

### The real issue

The property test requires integration points that:
- Were part of the original BL-597 implementation
- Were removed in a separate commit before the merge that dropped the files
- Are not part of the four files this ticket restores

This is a **separate defect** from the file drop. The property test was written assuming integration points that no longer exist. Either:
1. The property test is wrong (it shouldn't require integration points in other files)
2. The integration points need their own restoration ticket
3. The integration points should be added back as part of BL-597's original scope, not BL-1262's

## Remediation

1. **Revert the cleaner's changes** to front_desk_supervisor.bb and handoffd.bb. This ticket restores the four files and nothing else.
2. **Do not modify the property test** in this ticket either — that's also out of scope.
3. **Create a separate ticket** (or amend BL-597 if it's still open) to address the missing integration points. The property test failure is a real defect, but it's not the defect this ticket owns.
4. **Restore only the four files** named by the ticket, verbatim from commit 8562094f8 as the coder originally did.

## Acceptance

This ticket passes when:
- The four files are restored
- front_desk_supervisor.bb and handoffd.bb are unchanged from their state before this ticket
- The property test failure is either fixed by a separate ticket or acknowledged as a known issue

## Note on the property test

The property test's `KNOWN_EMIT_HOSTS` list includes handoff_lib.bb, which never had integration points added by the cleaner. This confirms the cleaner's approach was incomplete — they were trying to make the property test pass by adding integration points, but didn't add them to all required hosts. This is a sign the approach is wrong, not that it needs to be completed.
