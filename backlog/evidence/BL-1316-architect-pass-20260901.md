# BL-1316 Architect Pass — 2026-09-01

## Ticket
BL-1316: A seat's reasoning effort cranks or shrinks to the claimed ticket's mutation_cost

## Reviewed Commit
cbf9042674 (cleaner forward)

## Architecture Review

### Required Wiring (satisfied)
1. `swarmforge/scripts/seat_difficulty_lib.bb::effort-for-mutation-cost` (line 109) — PURE map from mutation_cost to effort token
2. `swarmforge/scripts/handoff_lib.bb::apply-claim-effort!` (line 581) — CONSUMER anchor at claim time

### Invariants (all satisfied)
1. **mutation_cost is the only difficulty signal**: `claim-effort-decision` destructures only `:backend`, `:cost`, `:pack-default-effort` from its argument map. No seat name, idle time, or other schema field is read. ✓

2. **Backend with no lever never receives unsupported CLI flag**: `effort-lever-backends` is a whitelist (`#{"claude"}`), `effort-lever-backend?` checks membership, and `claim-effort-decision` returns `{:apply? false}` for non-whitelisted backends. `apply-claim-effort!` never invents flags. ✓

3. **Effort from previous claim does not stick**: When `mutation_cost` is absent/nil, `claim-effort-decision` falls back to `pack-default-effort` (the pack/window default), not leaving the prior ticket's effort in place. ✓

### Two-Layer Boundary (respected)
- All changes are in `swarmforge/scripts/` (tmux substrate layer)
- No extension host or webview changes
- No browser storage involved
- No secrets written to target working directory
- SwarmForge driven via existing mechanisms (settings files, claim logic)

### Separation of Concerns (good)
- `seat_difficulty_lib.bb` is pure decision logic (no I/O)
- `handoff_lib.bb::apply-claim-effort!` is the IO edge (reads/writes settings file)
- Pure logic is testable without booting VS Code or tmux

### Property Tests (non-vacuous)
- `bl1316_claim_time_effort_property_runner.bb` encodes all three invariants
- Comments document how non-vacuity was verified (deliberately breaking code, seeing tests fail)
- Seeded RNG, no shared framework, 200 runs per invariant

## Verdict
PASS — architecturally compliant, invariants satisfied, required wiring present, property tests non-vacuous. Forward to hardender.
