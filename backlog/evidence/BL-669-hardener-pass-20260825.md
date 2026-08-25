# BL-669 hardener pass — outage-driven seat failover via steward — 20260825

**Architect tip:** `1e0024820c` (cleaner `2d79a9c68e` / coder `46d76ef425`)
**Task:** `BL-669-outage-driven-seat-failover-via-steward`

## Tip purity

Merged architect handoff (resolved BL-1146/BL-786 manifest conflicts — kept
hardener manifests). Authorize **BL-669** paths only. **0 deletes.**

## Product surface

`outage_failover_lib.bb` / `provider_outage_record_lib.bb` pure decisions;
`outage_failover_cli.bb` + store evaluate/apply/announce; handoffd sweep.
Steward `assignment-eligible?` gate; no `--override-uncertified`. Idle-boundary
apply with mid-turn defer; auto-revert on closed outage.

## Gates

| Gate | Result |
|------|--------|
| `outage_failover_test_runner.bb` | 8/8 ALL PASS |
| `bl669OutageFailoverSteward.property.test.js` | 1/1 |
| APS BL-669 feature | 6/6 |
| Soft Gherkin | `outcome: inapplicable` — not a pass (BL-638) |
| Surgical (7) | killed=7 survived=0 skipped=0 |
| BL-149 | `skip-cooldown` on outage_failover libs |

## Soft → surgical (BL-638)

Plain Scenarios only. Surgical needles on `outage_failover_lib.bb`: uncertified
gate, mid-turn defer, closed-outage revert, threshold guard, swap-active guard,
attended propose, fallback ranking.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-669.

By hardender.
