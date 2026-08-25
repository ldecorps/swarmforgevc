# Handoff depth warning counts tickets only (BL-683)

`swarm_handoff.bb`'s depth warning used to count every directory entry in
`backlog/active/`, so the permanent `.gitkeep` inflated `active=` by one on
**every** send. The coordinator promotion gate and status snapshot already
counted YAML tickets only; the warning disagreed.

## Fix (landed as BL-808; APS armed here)

The warning reuses the shared YAML-only counter
(`backlog-depth-lib/count-active-tickets` / the same family as handoffd's
open-slot and status paths). `.gitkeep` and other non-ticket entries do not
count.

## Operator note

A `WARNING: Active backlog depth exceeded (active=N, max=M)` line now matches
what the promotion gate believes. If you still see an off-by-one versus a
hand count of `*.yaml` files, that is a new bug — not expected `.gitkeep`
noise.

## Acceptance

`specs/features/BL-683-handoff-depth-warning-counts-non-tickets.feature`
