# Root intake drained 2026-07-22 — scope gates require human decision

Specifier drained `backlog/` root intakes at 14:01:45 UTC. Four tickets spec'd and placed in `backlog/paused/`:
- **BL-552** (Epic: Adaptive Quota & Budget Manager)
- **BL-553** (Slice 1: availability check)
- **BL-554** (Epic: Root capability commands)
- **BL-555** (Slice 1: `doctor` and `status` commands)

All have `human_approval: pending`. Cannot promote any until human decides two scope questions:

## BL-554: Standalone interpretation

Two readings of "standalone commands that work without a running swarm":

**(a) COMPATIBLE**: "Standalone" = no persistent multi-role pipeline needed. Commands can spin up single ephemeral agents/tmux panes via swarmforge/ scripts. Tmux remains substrate.

**(b) CONFLICTING**: "Standalone" = no tmux at all, agent processes spawned directly by the command caller. (Conflicts with architecture rule: tmux = substrate, no direct spawning.)

**Specifier recommends (a).** If (b): requires Article 5 constitutional amendment before BL-555/others can be specced.

**Decision needed**: which reading approved?

## BL-552: QuotaManager nesting

**Scope question**: Should QuotaManager be:
- NEW standalone component that ModelFactory calls, OR
- Nested slice INSIDE BL-525 ModelFactory / BL-547 Model Steward (reusing existing cooldown + BL-551 ledger)?

Overlaps existing work: BL-551 (active, cost ledger), BL-545 (umbrella), BL-025 ModelFactory.

**Specifier recommends nesting** (avoid fourth state store).
**Also confirm**: BL-553 should NOT promote ahead of operator's fixed order: BL-546 → BL-551 → BL-547 → BL-525 → BL-548.

**Decision needed**: nesting or standalone? Confirm operator order respected?

## Dependency chain

- BL-554 → BL-555 (Slice 1 is drafted only against reading (a); waiting on BL-554 decision)
- BL-552 → BL-553 (Slice 1 is scoped neutral on nesting; waiting on BL-552 decision)

All four held in `backlog/paused/` with `human_approval: pending` until decisions are made.
