# BL-1167 — hardener pass — 20260827

**Content tip:** `93cda4ca3` (cleaner tip-pure; architect handoff tip `0db5e13778`)
**Task:** `BL-1167-same-model-coder-seats-bypass-tier-routing`

## Tip purity

Detached at tip-pure content `93cda4ca3`. Harden delta is sweep + evidence
only — no merge into `swarmforge-hardender`.

## Gates

| Gate | Result |
|------|--------|
| Unit `seat_difficulty_lib_test_runner.bb` | **ALL PASS** |
| Properties `bl1167SameModelSeatRouting.property.test.js` | **2/2** |
| Acceptance BL-1167 feature | **3/3** |
| Soft Gherkin | `outcome: inapplicable` (plain Scenarios; exit 2) — not a pass |
| Cooldown `seat_difficulty_lib.bb` / `ready_for_next_task.bb` | **skip-cooldown** |
| Surgical sweep (5) | **killed=5 survived=0 skipped=0** |

## Soft → surgical (BL-638)

No Scenario Outline → no `KNOWN_VALUES` pins. Hand-authored surgical over
`seat_difficulty_lib.bb` locks uniform bypass polarity, seat-count floor,
equality, model presence, and stage-seat matching.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1167-same-model-coder-seats-bypass-tier-routing`.

By hardender.
