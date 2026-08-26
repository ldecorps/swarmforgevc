# Why Promotion Ranks by Epic Priority Before Ticket Priority

Before BL-900, the only way to make a whole epic's work happen sooner was to
bulk-rewrite `priority:` on the epic tracker **and** on every one of its
child tickets — `b174c9a6c` and `bc6bc9f63` each touched 18+ files to do
exactly that. That churned the backlog, destroyed each child's own
intra-epic ordering, and had to be repeated every time priorities moved.

Since BL-900, `promotion_gates_lib.bb`'s ranking reads the epic's own
priority directly, so raising an epic is a one-field edit again — for
example via the Mini App console's [epic reorder
screen](../how-to/BL-572-console-epic-priority-reorder.md) — and each
child's own `priority:` number goes back to meaning what it should: order
*within* its epic, not across epics.

## The rank key

`rank-candidates` orders eligible promotion candidates by:

```
[expedited?  epic-priority  own-priority  id]
```

Epic priority is spliced in **after** the Article 3.2.4 expedite bucket and
**before** the candidate's own `priority:`. Placing it there — rather than
first — is what keeps the expedite bucket strictly first *by construction*,
not by a guard that has to be kept in sync separately.

## Resolving an epic's priority

`epic-priority-index` builds a one-time map, per ranking call, from every
`type: epic` tracker's `epic:` slug to its own `priority:` (scanning
`active/`, `paused/`, and `done/`, the same status-dirs precedent
`ticket_status_lib.bb` already uses). Two deliberate fallback rules make the
lookup total rather than partial:

- **An epic id with more than one tracker** ranks by its most urgent
  (lowest) tracker priority. This is real, not hypothetical: as of this
  writing `swarm-intelligence-layer` has three trackers at priorities 30,
  31, and 35 — the epic ranks at 30.
- **A candidate whose epic has no tracker at all, or no `epic:` field**
  keeps its *own* priority as its epic priority, so it ranks exactly as it
  did before this change. The alternative — treating a missing tracker as
  effectively infinite, matching how a missing `priority:` is already
  handled elsewhere — was rejected because it would silently bury every
  child of an untracked epic (five live `cost-intelligence` children, at
  the time this was written) behind every tracked epic's children,
  regardless of how urgent any of them actually are.

Ties fall through to the child's own `priority:`, then to its id — the same
tie-break that existed before this change.

## What this doesn't touch

- **Ordering only.** This never grants an extra `backlog/active/` slot
  (Article 3.2 rule 1), never overrides orthogonality (Article 3.2 rule 3),
  the mutation-heavy scheduling window (Article 3.4), or the circuit
  breaker (Article 3.5) — an epic being urgent competes for its place in the
  queue, it doesn't buy a bigger queue.
- **`direction: queue-jump`** is unaffected because it was never a ranking
  input to begin with — `direction:` is read by no promotion code; a
  queue-jump is a coordinator action described in `workflow.prompt`, not a
  `rank-candidates` term.
- **Ambulance mode** ([the hold](../how-to/BL-655-ambulance-mode-the-hold.md))
  is an orthogonal override — only one ticket's parcels move at all while it
  is active — so epic-priority ordering has nothing to interact with there
  either.
- **The Article 3.2.4 expedite lane** (a `type: defect` of `critical`/`high`
  severity) still ranks ahead of everything else, regardless of either
  candidate's epic priority.

## Where it's wired

`rank-candidates` is called from three places, and all three are
epic-priority-aware: `promotion_gates_cli.bb`'s `cmd-select` (the path
`promote_and_route_next.sh` actually drives), and `chase_sweep_lib.bb`'s
`top-open-slot-candidate` / `top-expedited-paused-candidate` (used to name
the ticket in the BL-798 open-slot escalation nudge and the BL-679
ambulance-release announcement). The second pair was missed on the first
pass — see the bounce recorded in
`backlog/evidence/BL-900-epic-priority-before-ticket-priority-hardener-bounce-20260816.md`
— because a nudge that names a different ticket than the one that will
actually be promoted next is a misleading operator signal, not a harmless
gap.
