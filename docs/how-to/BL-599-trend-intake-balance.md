# Reading intake-balance trends (filed vs closed) (BL-599)

*How-to. Task-oriented: see whether the backlog is growing or shrinking —
tickets filed per day versus tickets closed per day.*

Velocity already tracks closes. BL-599 adds the **intake** side of the ledger
and the **net** (filed − closed) from the **same** git-history adapter
`deliveryMetrics` already uses — not a second backlog history reader.

## What it measures

| Signal | Counts as |
| --- | --- |
| Filed | New buildable `BL-*.yaml` under `backlog/active/` or `backlog/paused/`, or backlog-root `INTAKE-*.md` |
| Closed | Ticket path moving into `backlog/done/` |
| Net | Filed − closed over the window (positive ⇒ backlog growing) |

**Epic trackers** (`type: epic` paths) never count as buildable intake.

## Where it lives

| Piece | Location |
| --- | --- |
| Derive events | `deriveIntakeBalanceEvents` in `extension/src/metrics/deliveryMetrics.ts` |
| Aggregate | `computeIntakeBalance` → exposed on `computeDeliveryMetrics` as `intakeBalance` |
| Series / delta | `trend.ts` (current / prior / delta) |
| Sibling PNG burndown | `notDoneBurndown.ts` (briefing email) — reuse helpers; do not add a third remaining-count |

Aggregation is pure over derived events — unit-testable without live git.

## Operator check

After a morning briefing or metrics tick that calls `computeDeliveryMetrics`,
inspect `intakeBalance` for the active window: filed, closed, and net. A
sustained positive net means intake outruns drain (BL-591 ETA recedes).

## Verify

```bash
cd extension && npm test -- deliveryMetricsIntakeBalance
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-599-trend-intake-balance.feature
```

Acceptance: `specs/features/BL-599-trend-intake-balance.feature`

Related: [Reading front-desk human-loop reliability trends](BL-595-trend-human-loop-reliability.md),
epic BL-594 swarm-behaviour-trends.
