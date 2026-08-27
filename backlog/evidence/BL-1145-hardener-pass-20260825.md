# BL-1145 hardener pass — open-slot nudge skips epic trackers — 20260825

**Architect tip:** `17cf20b291` (coder `e92160854` / cleaner `c39547cb6`)
**Task:** `BL-1145-open-slot-nudge-skips-epic-trackers`

## Tip purity

Merged architect handoff. Authorize **BL-1145** paths only (gates lib + APS +
ticket + hardening sweep). **0 deletes.**

## Product surface

`promotion_gates_lib/evaluate`: `epic-type-refusal` + `blocked-status-refusal`
after hold, before human_approval — open-slot nudge and promote share one
structured exclusion (BL-663 / BL-1145).

## Gates

| Gate | Result |
|------|--------|
| `promotion_gates_lib_test_runner.bb` | ALL PASS |
| `promotion_gates_lib_property_runner.bb` | ALL PROPERTIES HOLD |
| APS BL-1145 feature | 3/3 |
| Soft Gherkin | `outcome: inapplicable` — not a pass (BL-638) |
| Surgical (6) | killed=6 survived=0 skipped=0 |
| BL-149 | `promotion_gates_lib.bb` `skip-cooldown` |

## Soft → surgical (BL-638)

Hand surgical over evaluate-chain drops, refusal never-fires, gate label
swap, epic/blocked order drift vs human_approval.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1145.

By hardender.
