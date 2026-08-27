# Open-slot nudge skips type: epic trackers (BL-1145)

## The gap

Open-slot nudge/escalation (BL-798 / BL-963) names top candidates via
`promotion_gates_lib/evaluate`. After BL-1100 removed prose
do-not-promote greps, that chain lacked a structured `type: epic` refusal
while `promote_and_route_next.sh` already refused epics via `is_epic_type`.
Epic trackers (e.g. BL-545) could win the nudge forever, leave the slot
empty, and trigger escalation noise.

## What changed

| Piece | Change |
| --- | --- |
| `promotion_gates_lib.bb` | `epic-type-refusal` + `blocked-status-refusal` on `evaluate` after hold, before `human_approval` |
| Open-slot nudge | Inherits the same chain via `nudge-eligible-candidates` (BL-663) |
| `promote_and_route_next.sh` | Unchanged explicit epic refuse via `is_epic_type` |

Gate order on `evaluate`: hold → epic → blocked → human_approval →
acceptance → depends_on → depth.

Refusal shapes:

1. `type: epic` → `gate=epic` — trackers are never promotion or nudge candidates
2. `status: blocked` → `gate=blocked` — matches promote auto-pick skip

A paused epic with higher priority than a real feature is **not** named as
open-slot top candidate and does not accrue nudge count. When both are
present, the non-epic feature wins.

## Operator note

When open-slot nudge previously named an epic (BL-545) through repeated
nudges, do **not** promote the epic to silence the alert. After deploy, a
different eligible top candidate clears escalation via the existing BL-798
reset when candidacy changes.

Verify:

```bash
bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb
bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb
```

Acceptance:
`specs/features/BL-1145-open-slot-nudge-skips-epic-trackers.feature`

Related: [BL-626 promotion acceptance gate](BL-626-promotion-gate-rejects-unmaterialized-feature-draft.md),
[BL-900 epic priority ranking](../explanation/BL-900-epic-priority-promotion-ranking.md).
