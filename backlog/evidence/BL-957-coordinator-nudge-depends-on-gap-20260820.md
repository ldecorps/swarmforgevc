# BL-957 spec gap — open-slot nudge may name depends_on-blocked candidates

Raised by: architect (priority-00 note 20260819T231745Z_000267, headline only).
Verified by: coordinator, 2026-08-20. **Claim CONFIRMED.**

## Verification
`swarmforge/scripts/chase_sweep_lib.bb` — which owns the open-slot nudge — contains
**zero** occurrences of `depends_on` (grep, whole file). Its two relevant functions:

- `decide-open-slot-nudge?` gates on: `active-count < cap`, `paused-eligible-count > 0`,
  no pending nudge, not in cooldown, ambulance not engaged. **Dependency state is not
  an input.**
- `open-slot-nudge-message` (BL-798 invariant 1) names the top Article-3.2.4 candidate
  and appends ` awaiting approval` when unapproved. **It has no comparable notion of
  "blocked by an unsatisfied depends_on".**

## Why this matters once BL-957 lands
BL-957 makes the promotion gate refuse a ticket whose `depends_on` is not in
`backlog/done/`, failing closed. The nudge picker is unaware of that gate, so a
blocked ticket can be named as the top candidate the gate will *always* refuse.

Consequences, both on the coordinator's own SUP-1 path (BL-798 invariant 3):
1. Every such nudge is a promotion decision I cannot complete by promoting. I must
   record a blocking reason on the ticket instead — correct, but repeated forever
   while the dependency is unlanded.
2. `open_slot_escalation_threshold` (default 3) then escalates to the operator as
   *promotion inaction* and goes silent for that candidate. The escalation is spent
   on a ticket that was never promotable, and the silence afterwards reads as
   resolution when nothing was resolved.
3. `paused-eligible-count` can be positive purely from blocked tickets, so nudges
   fire when the true promotable set is empty.

## Scope question for the specifier (not decided here)
BL-957's invariant 1 binds "every promotion ROUTE ... through the one
promotion_gates evaluate chain". The nudge is a promotion *request*, not a route,
so it is arguably outside BL-957's slice. Either extend BL-957's candidate-eligibility
definition to consult the same gate chain, or mint a sibling slice for the nudge
picker. Coordinator has no view on which; both close the hazard.

Ticket is in flight (architect stage) — spec unchanged by this file per the
amend-in-flight rule. Recorded as evidence only.
