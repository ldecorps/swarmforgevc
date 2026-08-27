# Expedite lane is defect-only; `type: bug` is retired (BL-1095)

## The gap

Article 3.2.4’s expedite predicate still matched legacy `type: bug` under a
transition clause (“drop it once no ticket carries it”). That trigger had
fired for promotable tickets, but:

1. Nobody owned the discharge — the clause sat spent in the boot-inlined
   article.
2. Ranking only reads `backlog/paused/`, so a done `bug` ticket never reaches
   `expedited?` anyway; keeping the member was vacuous by construction.
3. Dropping the member **without** a mint refusal would let a later `bug`
   ticket lose the expedite lane silently.

## What changed

| Surface | Behaviour |
| --- | --- |
| `promotion_gates_lib.bb` `expedited-types` | `#{"defect"}` only |
| Mint hygiene (`backlog_hygiene_lib.bb`) | `type: bug` → `RETIRED-TICKET-TYPE … use type: defect` |
| Transition / property tests | Deleted the “bug still expedited” branch (retirement, not inversion) |

Only `type: defect` with `severity: critical` or `high` takes the lane.
Missing severity still fails closed. Done-tree `bug` tickets remain historical
and are never promotion candidates.

## Operator note

Mint new defects as `type: defect`, never `bug`. If hygiene prints
`RETIRED-TICKET-TYPE`, rename the type and re-run the gate.

Constitution Article 3.2.4 prose trim (removing the spent transition clause
from the boot prefix) remains a **specifier** deliverable (BL-798); this
parcel lands the code half that the article already authorised.

Acceptance:
`specs/features/BL-1095-retire-the-expedite-lanes-legacy-bug-type.feature`
