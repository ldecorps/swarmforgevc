# Behaviour-trend series on the live Mini App console (BL-603)

## What this is

A read-only Trends board on the LIVE holistic console (the same
token-authed bridge surface as the epic-reorder and spec-tree screens,
BL-572/BL-592) — one screen surfacing every BL-594 behaviour-trend series
that has landed:

| series id | producer |
| --- | --- |
| `human-loop-reliability` | `humanLoopReliability.ts` |
| `mono-router-rotation` | `rotationDynamics.ts` |
| `self-heal-events` | `selfHealTelemetry.ts` |
| `false-alarm-rate` | `alertTelemetry.ts` |
| `intake-balance` | `deliveryMetrics.ts` |
| `human-decision-latency` | `humanDecisionLatency.ts` |
| `compaction-cadence` | `compactionCadence.ts` |
| `handoff-latency` | `handoffLatency.ts` |
| `global-token-tokens` | `globalTokenConsumption.ts` |

It is a pure consumer slice: no instrumentation added, no write path. Each
series is computed through the shared `computeTrend` framework
(`extension/src/metrics/trend.ts`) and served fresh over the bridge on
every poll — it reflects live data, not a pinned SHA.

## Why a live route, not the static PWA

Per this project's two-phone-surfaces rule, the static backlog-dashboard
PWA carries only git-SHA-derivable data with no bridge connectivity. Trend
series are live/machine-local data, so they ride the LIVE holistic console
only. `GET /trends?token=...` is refused without a valid bridge token, and
no trend series is readable from the static PWA.

## The honesty rule

A series with nothing to plot renders as **"no data yet"** and draws
nothing — never a zero, a flat line, or an interpolated point. This covers
two distinct causes that read identically on purpose:

- the producer module has not landed a source reader yet
  (`human-decision-latency` at BL-603 mint), and
- the producer landed but records nothing today — `self-heal-events` is
  live on this console dark until BL-1273 restores its production emit
  sites (a merge, `2e37477ec`, dropped all five of them after BL-597
  shipped).

Distinguishing the two on screen would risk a flat line at zero reading as
"the swarm never self-heals" — exactly the false green BL-597 was built to
prevent.

## Registering a series

Registering a series is the only edit needed to publish it: append an
entry to `extension/src/metrics/trendsBoardRegistry.ts`. Neither the
`/trends` payload builder (`buildTrendsBoardState` in
`extension/src/bridge/bridgeState.ts`) nor the console renderer
(`renderTrendsBoard` in `extension/src/bridge/holisticUiHtml.ts`) holds a
per-series list — both map over whatever the registry/payload carries, so
a registered series appears without touching either.

## Where it lives

| Piece | Location |
| --- | --- |
| Board shape, loader contract, honesty-rule helpers | `extension/src/metrics/trendsBoard.ts` |
| The nine registered series | `extension/src/metrics/trendsBoardRegistry.ts` |
| `/trends` bridge route | `extension/src/bridge/bridgeServer.ts` |
| Payload builder | `extension/src/bridge/bridgeState.ts` — `buildTrendsBoardState` |
| Console section + renderer | `extension/src/bridge/holisticUiHtml.ts` — `trendsBoard` section id, `renderTrendsBoard` |

## Verify

```bash
npm test -- extension/test/trendsBoard.test.js extension/test/holisticUiMetrics.test.js \
  extension/test/trendsBoardEverySeriesReachable.property.test.js \
  extension/test/trendsBoardNeverFabricates.property.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-603-trends-published-on-mini-app.feature
```

## Out of scope

The series instrumentation itself (the nine BL-594 producer tickets own
that); the static PWA; the morning-briefing analysis (BL-604 owns that
consumer surface).
