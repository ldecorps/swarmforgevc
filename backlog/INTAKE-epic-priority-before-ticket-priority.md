# Raw intake — Promotion order should consider epic priority before ticket priority

Status: **new intake, not minted.** Capture only (human via coordinator chat,
2026-08-15). Specifier: mint the ticket and decide shape/landing.

## Human request (verbatim)

> can we add an intake so that the epic priority is considered before the
> ticket priority (except jumpq, defects and ambulence)

## Why this is in front of you

Coordinator was asked how promotion ordering works and confirmed the current
behavior: `promotion_gates_lib.bb`'s ranking key is `[expedited? priority id]`
— the ticket's OWN `priority:` field, with the Article 3.2.4 expedite bucket
first. `epic:` is read only to build an orthogonality ADVISORY (flagging when
a candidate shares an epic with something already active) — it plays no part
in ordering. A child ticket's `priority:` can drift out of sync with its
epic's stated priority with nothing enforcing consistency; promotion follows
the child's number regardless.

## Goal

1. Mint a ticket for adding epic-priority-first ordering to the promotion
   ranking: when comparing two otherwise-eligible candidates, the containing
   epic's own priority should be considered ahead of the ticket's individual
   `priority:` field.
2. **Exceptions the human named — carry these through, do not drop them:**
   - `direction: queue-jump` tickets (existing field, 33 live uses) — keep
     current behavior, still jump ahead regardless of epic priority.
   - `type: defect` tickets under the Article 3.2.4 expedite lane
     (critical/high severity) — keep expediting ahead of everything,
     unaffected by epic ordering.
   - Ambulance-mode tickets (`docs/how-to/BL-655-ambulance-mode-the-hold.md`)
     — already an orthogonal override mechanism (only one ticket's parcels
     move at all); epic-priority ordering must not interact with or weaken
     it.
3. Specifier decides the concrete mechanism (e.g. read the epic ticket's own
   `priority:` field and splice it into the sort key ahead of the child's
   priority; handle epics with no matching epic-tracker ticket; decide
   tie-break when two candidates share the same epic priority — likely still
   the child's own priority, then id).
4. Note for specifier: there is also a pre-existing, apparently-unrelated
   `direction: expedite` field value (46 uses) distinct from the Article
   3.2.4 defect-severity expedite lane — worth a quick check that this
   change doesn't collide with or get confused for that value.

## Out of scope for this intake

- Changing the Article 3.2.4 expedite lane itself.
- Changing ambulance mode or the expeditor (rungs 2/3 of the escalation
  ladder) — this is purely about ordinary promotion-queue ordering (rung 0).
- Backfilling/auditing existing tickets whose `priority:` drifted from their
  epic's — only the ordering algorithm is in scope unless specifier judges
  otherwise.
