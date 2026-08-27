# BL-1145 — architect pass — 20260825

**Tip:** cleaner `7e6d5a6552` (coder `e921608549`)
**Handoff:** `00_20260825T204035Z_000862_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Cleaner tip stacks prior QA merge-ups (BL-1142/1143 lineage). **0 deletes**
vs `origin/main`. Authorize **BL-1145 paths only** (gates lib + APS + ticket).

## Architecture

- Root cause: `promotion_gates_lib/evaluate` lacked `type: epic` /
  `status: blocked` refusals while `promote_and_route_next` had them via
  `is_epic_type` — open-slot nudge named epic trackers (BL-545) forever.
- Fix: `epic-type-refusal` + `blocked-status-refusal` on `evaluate` after
  hold, before human_approval — one BL-663 chain for nudge + promote.
- Explicit epic promote still refuses via shell `is_epic_type` (APS 03).

## Verification

| Check | Result |
|-------|--------|
| `promotion_gates_lib_test_runner.bb` | ALL PASS |
| `promotion_gates_lib_property_runner.bb` | ALL PROPERTIES HOLD |
| APS BL-1145 feature | 3/3 pass |
| Tip deletes | 0 |

By architect.
