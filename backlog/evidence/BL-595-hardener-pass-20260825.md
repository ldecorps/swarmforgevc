# BL-595 hardener pass — 20260825

**Architect tip:** `6242eb144c` (cleaner `0ab899cca8` / coder `4c14e0364b`)
**Task:** `BL-595-trend-human-loop-reliability`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **11 paths**, **0 deletes** (pre-evidence).

## Product surface

Human-loop reliability telemetry: four series (approval-tap, steering,
poll-health, tick-duration), async append-only ledger, pure window
aggregation. Measuring must not degrade the front desk.
Authorize **BL-595 paths only**.

## Hardener deltas

APS steps: lock Examples vocabulary (KNOWN_OUTCOMES / KNOWN_DROP_REASONS)
and exact `kind` / `summary` branches so soft Gherkin cannot round-trip
opaque case flips.

## Gates

| Gate | Result |
|------|--------|
| `humanLoopReliability.test.js` | 6/6 |
| APS BL-595 feature | 16/16 |
| Soft Gherkin (after step sharpen) | killed=23 survived=0 |
| Surgical (6 on out/) | killed=6 survived=0 skipped=0 |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-595 only.

By hardender.
