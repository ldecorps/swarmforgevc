# BL-1304 Architect Pass — 2026-09-01

## Ticket
BL-1304: expedite --dry-run walks into the real stage launcher

## Reviewed Commit
a4bd64558e (cleaner forward)

## Architecture Review

### Required Wiring (satisfied)
1. `specs/pipeline/steps/index.js::bl1304DryRunSpawnsNothingSteps` — step handler registered ✓

### Invariants (all satisfied)
1. **Dry-run starts no stage process and creates no branch/worktree/backlog move**: `dry-run-plan!` never calls `run-stage!`, and the guard is at the call site in -main (`if (:dry-run? opts) (dry-run-plan! ...) (drive-stages! ...)`), so the real driver is never reached on a dry run. ✓

2. **Dry-run succeeds and prints a plan whenever a real run could start**: `dry-run-plan!` logs the stage chain (`log! "dry-run plan: stages" ...`) and returns a shaped result `{:ticket :done :bounces {} :history [] :bound bound-info}` so downstream reads need no dry-run branch. ✓

### Two-Layer Boundary (respected)
- All changes are in `swarmforge/scripts/expedite_cli.bb` (tmux substrate layer)
- No extension host or webview changes
- No browser storage involved
- No secrets written to target working directory
- SwarmForge driven via existing mechanisms

### Separation of Concerns (good)
- The guard is at the call site in -main (pure decision)
- `dry-run-plan!` is the IO edge (logging, returning result)
- Shaped like a real `drive-stages!` success so downstream code needs no dry-run branches

### Property Tests (non-vacuous)
- `bl1304DryRunSpawnsNothing.property.test.js` encodes both invariants
- Generator reaches "whatever an earlier run left on disk" by constructing cases where worktree EXISTS (via `git worktree add`)
- Drives the real expedite_cli.bb through the real fixture, varying preconditions (worktree state, ticket placement, bounce bound)

## Verdict
PASS — architecturally compliant, invariants satisfied, required wiring present, property tests non-vacuous. Forward to hardender.
