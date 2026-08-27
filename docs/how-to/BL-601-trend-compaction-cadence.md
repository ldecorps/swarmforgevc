# Reading context-compaction cadence trends (BL-601)

*How-to. Task-oriented: see which roles are under context pressure —
how often they auto-compact, and at what token level.*

Compaction frequency is a proxy for context load. BL-601 records each
**structured** compaction (not pane spinner chrome) and trends
compactions/hour plus the token-at-compaction distribution per role.
Measurement only — it never tunes compaction thresholds.

## Signal (what counts)

| Source | Counts? |
| --- | --- |
| Context-event with `compaction: true` (GH-22 / BL-665 producer) | Yes — emit `{role, model, tokens-at-compaction, ts}` |
| Pane spinner text alone (`auto-compact`, `Compacting`, …) | No |

`tokens-at-compaction` is the event's `input_tokens` at that instant.

Roles without a reliable compaction signal stay **NA** — never a fabricated
zero. Aggregation takes an explicit `detectableRoles` allow-list; any other
role reads `applicable: false`.

## Where it lives

| Piece | Location |
| --- | --- |
| Derive + aggregate | `extension/src/metrics/compactionCadence.ts` |
| Append-only ledger | `.swarmforge/telemetry/compaction-<YYYY-MM>.jsonl` via `compactionTelemetryStore.ts` |
| Trend delta | `computeTrend` from `trend.ts` (imported **inward** by `compactionCadence` — no re-export back into `trend.ts`) |
| Acceptance | `specs/features/BL-601-trend-compaction-cadence.feature` |

Aggregation is pure over in-memory compaction records — unit-testable without
live panes or transcripts.

## Operator check

After context telemetry has written `compaction:true` events and the store has
derived ledger lines, run the pure aggregator (or the APS feature) for a role
you care about:

- High **compactions/hr** ⇒ heavy context pressure for that role/model.
- **Token distribution** (min / median / max) ⇒ whether the trigger level
  looks sane for that model.
- **NA** ⇒ no reliable signal yet — do not treat as "never compacted."

Pairs naturally with BL-596 (rotation cost): a persona that compacts constantly
is also a rotation-cost signal.

## Verify

```bash
cd extension && npm test -- compactionCadence
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-601-trend-compaction-cadence.feature
```

Related: [Reading intake-balance trends](BL-599-trend-intake-balance.md),
[Reading front-desk human-loop reliability trends](BL-595-trend-human-loop-reliability.md),
epic BL-594 swarm-behaviour-trends.
