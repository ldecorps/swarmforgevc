# Adapt-tier effort dial follows outcome signals (BL-1317)

## The gap

[BL-1316](BL-1316-claim-time-effort-follows-ticket-difficulty.md) retunes a
seat's reasoning effort once, at claim time, from the claimed ticket's
`mutation_cost`. It never revisits that choice: a ticket that turns out
harder than its `mutation_cost` suggested — and bounces because of it — keeps
running at the same effort it started at. BL-236's own text deferred this
retuning-from-outcomes case as the "Adapt" tier (Suggest-only shipped first).
This ticket is that Adapt tier. The still-deferred "Auto" tier (apply within
a budget with no signal at all) stays out of scope.

## What changed

At the same moment a seat's held ticket completes — the point
`done_with_current_task.bb` already records the lifecycle ledger entry — the
seat's effort now also moves in response to how that completion went:

1. **Pure decision** — `extension/src/tools/effortDialAdapt.ts`
   (`decideAdaptEffort`, TypeScript side) and
   `swarmforge/scripts/seat_difficulty_lib.bb` (`adapt-effort-decision`, bb
   side) hold the same policy, expressed twice because the two consumers
   live in different languages:
   - a **bounce** (the completed handoff is a reverse hop — this seat's own
     work coming back) climbs the seat's effort **one notch** above wherever
     it is now;
   - a **clean** completion counts toward a descent only once
     `ADAPT_DEFAULT_CLEAN_STREAK` (3) of them have accumulated in a row at
     the current effort, and even then drops **one notch**, never below the
     BL-1316 claim-time baseline for the ticket the seat is holding;
   - a backend with no reasoning-effort lever (`backendHasLever false` /
     absent from `effort-lever-backends`) always decides not to apply —
     Adapt never invents an unsupported flag for a lever-less backend.
   - Both sides read the same ladder: the bb `adapt-effort-ladder` mirrors
     TypeScript's `ADAPT_EFFORT_LADDER` (itself BL-236's own `EFFORT_LEVELS`,
     not a copy), and
     `swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` gates that
     the two literals agree (BL-897).
2. **IO edge** — `handoff_lib.bb`'s `record-effort-adapt!` is the sole place
   that writes anything: at most the seat's launch settings file (the same
   `effortLevel` BL-1316's claim-time apply writes, read back on respawn)
   and a small per-role streak-counter state file. It never writes
   `swarmforge.conf` or any pack window line — Adapt is in-memory/respawn
   only, same posture as BL-235/BL-236. A lever-less backend, a missing
   settings file, or unreadable JSON all leave the completion unaffected;
   the write is best-effort and never blocks or fails a completion.
3. **Wiring** — `done_with_current_task.bb`'s `record-effort-adapt-for!`
   calls the IO edge at the same completion point the lifecycle ledger
   already observes, deriving the signal from the completed handoff itself
   (`non-forwarding?` → `"bounce"`, otherwise `"clean"`) and the BL-1316
   baseline from the shared `active-ticket-mutation-cost` lookup — the same
   lookup `ready_for_next_task.bb`'s claim-time apply uses, so the two
   ticket-difficulty readings can never drift apart for the same ticket.

## Operator note

No new configuration. Nothing on disk changes as a result of Adapt — a
seat's dial moves only in memory for its current pane and reverts to the
BL-1316/BL-236 defaults on the next fresh claim or restart. Only backends
listed in `effort-lever-backends` (currently `claude`) are ever affected.

Orthogonal to BL-1316 (which sets the floor Adapt climbs from and never
drops below) and BL-236 (the static per-role Suggest dial and its
`EFFORT_LEVELS` ladder, which Adapt climbs onto every rung of rather than
restating).

Acceptance:
`specs/features/BL-1317-adapt-tier-effort-from-outcome-signals.feature`

Related: [Claim-time reasoning effort follows ticket difficulty](BL-1316-claim-time-effort-follows-ticket-difficulty.md).
