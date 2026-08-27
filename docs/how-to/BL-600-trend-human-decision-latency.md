# Reading human-decision latency trends (BL-600)

*How-to. Task-oriented: see how long tickets wait on a human verdict —
from ApprovalRequested ask to approve/amend — separate from swarm velocity.*

Some tickets wait on the swarm; some wait on the human. BL-600 trends
ask→verdict latency per gate so “why is this epic slow” can tell a velocity
problem from an approval-queue problem. **Measurement only** — it never
nudges, blocks, or alters asks or verdicts.

## What it measures

| Case | Result |
| --- | --- |
| Ask + verdict recorded | One decided latency (ms) for that gate (`approve` / `amend`) |
| Ask still pending | **Open age** only — never counted as a fast completed decision |

Aggregation reuses `stageDwell.splitOutliers` for median + outlier honesty,
then `computeTrend` for current / prior / delta.

## Where it lives

| Piece | Location |
| --- | --- |
| Ask timestamp | `approvalAskPostedAtMs` / ask-message store pairing |
| Pure derive + aggregate | `extension/src/metrics/humanDecisionLatency.ts` |
| Outlier honesty | `stageDwell.ts` `splitOutliers` |
| Trend delta | `computeTrend` from `trend.ts` (imported **inward** — no re-export) |
| Acceptance | `specs/features/BL-600-trend-human-decision-latency.feature` |

## Operator check

After metrics/briefing ticks that fold decision-latency series, inspect median
and outliers per window. A multi-day median is a human-attention bottleneck;
open waits stay visible separately from decided medians.

## Verify

```bash
cd extension && npm test -- humanDecisionLatency
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-600-trend-human-decision-latency.feature
```

Related: [Reading intake-balance trends](BL-599-trend-intake-balance.md),
[Reading front-desk human-loop reliability trends](BL-595-trend-human-loop-reliability.md),
epic BL-594 swarm-behaviour-trends.
