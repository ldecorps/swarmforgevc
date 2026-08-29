# Architect Review: BL-1261-hold-divergence-audit

**Reviewed commit**: 62e37fcc07 (cleaner)
**Review date**: 2026-08-29
**Reviewer**: architect
**Verdict**: PASS — architecture compliant

## Changes reviewed

1. `swarmforge/scripts/hold_divergence_audit_lib.bb` — core audit library (144 lines)
2. `swarmforge/scripts/hold_divergence_audit_cli.bb` — thin CLI wrapper (31 lines)
3. `swarmforge/scripts/promote_and_route_next.sh` — integration call site (9 lines added)
4. `extension/test/bl1261HoldDivergenceAudit.property.test.js` — property tests encoding all three invariants (264 lines)
5. `specs/pipeline/steps/bl1261HoldDivergenceAuditSteps.js` — acceptance step handlers (181 lines)
6. `specs/pipeline/steps/index.js` — step handler registration (3 lines changed)

## Architecture compliance

### Module structure
- **Library/CLI separation**: Clean. The library (hold_divergence_audit_lib.bb) contains all logic; the CLI (hold_divergence_audit_cli.bb) is a thin wrapper that parses args and calls the library. Follows the CLI main() thin-wrapper rule.
- **Function decomposition**: Well-organized into file listing, ticket ID extraction, role directory discovery, core audit logic, and reporting. Each function has a single responsibility.
- **Namespace isolation**: The library uses a Clojure namespace (hold-divergence-audit-lib), preventing pollution of the global namespace.

### Invariants verification
All three declared invariants are properly encoded as property tests:

1. **Invariant 1 (report only)**: Property test snapshots the filesystem before and after running the audit, verifying no files are created, modified, or deleted. ✅ PASS
2. **Invariant 2 (fail closed)**: Property test makes a mailbox unreadable (chmod 000) and verifies the audit reports UNRESOLVED, never CLEAN. ✅ PASS
3. **Invariant 3 (batch-aware discovery)**: Property test places parcels in both direct and batch_* subdirectories, verifying both are discovered. ✅ PASS

All property tests pass (50 runs each, ~2s total).

### Dependency gate
- JavaScript files (property tests, step handlers): PASS — no forbidden edges
- Babashka scripts: Not subject to the JavaScript dependency gate (different toolchain)

### Two-layer boundary
- The implementation is in swarmforge/scripts/ (Babashka), not in the extension host or webview. This is architecturally correct — the audit is a swarm-level concern, not an extension concern.
- No violation of the tile-as-view / tmux-as-substrate boundary.

### Integration
- The audit is called from `promote_and_route_next.sh` (line 11-18 in the diff), the required call site per the ticket's required_wiring.
- Integration is non-blocking (`|| true`), report-only, and runs after the promotion completes.
- Matches the pattern established by BL-1228's active_pool_freshness_audit.sh.

### Acceptance step handlers
- Registered in specs/pipeline/steps/index.js (line 864).
- Handlers drive the real CLI via execFileSync, not a reimplementation.
- Step handlers are in the testable module category (pure logic, no VS Code API).

## Correctness review

The implementation correctly addresses the defect:
- **Divergence detection**: Compares backlog/hold/ tickets against parcels in role mailboxes (inbox/new and inbox/in_process for each role).
- **Batch awareness**: Uses list-handoff-files-with-batches to descend one level into batch_* subdirectories, matching the pattern from chase_sweep_lib.bb.
- **Fail-closed**: Checks fs/readable? on each mailbox directory and reports unreadable ones as UNRESOLVED.
- **Report-only**: No fs/delete, fs/move, or similar operations anywhere in the library.

## Findings

NONE — clean review pass.

The implementation is architecturally sound, the invariants are properly encoded and verified, and the integration follows established patterns. The audit correctly addresses the divergence defect without modifying SwarmForge source or violating any architectural boundaries.
