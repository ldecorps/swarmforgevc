# Reading handoff latency trends (BL-602)

*How-to. Task-oriented: see how long parcels wait between send and claim —
per recipient role — so a dormant-role queue wait is visible as latency,
not a silent “did it vanish?”.*

On mono-router, a handoff to a dormant role waits until the resident rotates
into that role. BL-602 trends **enqueue→dequeue** wait from headers already
on the handoff file. **Measurement only** — it never changes dispatch,
rotation, or `ready_for_next` claim behaviour.

## What it measures

| Case | Result |
| --- | --- |
| `enqueued_at` + `dequeued_at` | One processed latency (ms) for that recipient |
| Still queued (`enqueued_at` only) | **Open wait** only — never counted as a fast pickup |

Gather covers **master and worktree** role mailboxes (`new/`, `in_process/`,
`completed/`). Aggregation reuses `stageDwell.splitOutliers` for median +
outlier honesty, then `computeTrend` for current / prior / delta.

## Where it lives

| Piece | Location |
| --- | --- |
| Send stamp | `enqueued_at` on outbound handoff headers |
| Claim stamp | `dequeued_at` when `ready_for_next` moves `new/` → `in_process/` |
| Pure derive + gather + aggregate | `extension/src/metrics/handoffLatency.ts` |
| Outlier honesty | `stageDwell.ts` `splitOutliers` |
| Trend delta | `computeTrend` from `trend.ts` (imported **inward** — no re-export) |
| Acceptance | `specs/features/BL-602-trend-handoff-latency.feature` |

## Operator check

After parcels have been claimed (or sit waiting), inspect median and outliers
per recipient role. A multi-hour median for one role is a starvation /
rotation signal (pairs with BL-596). Open waits stay visible separately from
processed medians.

## Verify

```bash
cd extension && npm test -- handoffLatency
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-602-trend-handoff-latency.feature
```

Related: [Reading human-decision latency trends](BL-600-trend-human-decision-latency.md),
[Reading self-heal event trends](BL-597-trend-self-heal-events.md),
epic BL-594 swarm-behaviour-trends.
