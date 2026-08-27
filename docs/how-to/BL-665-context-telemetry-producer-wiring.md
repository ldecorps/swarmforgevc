# Context-telemetry producer wiring (BL-665)

*How-to. GH-22 shipped the store and CLI; GH-23's dashboard is read-only.
BL-665 wires the missing producer — a deterministic transcript walker that
fills `.swarmforge/telemetry/context-events.jsonl` through the existing
`record` path.*

## What runs where

| Path | Module | Behaviour |
| --- | --- | --- |
| Core producer | `extension/src/metrics/contextTelemetryProducer.ts` | Walks role transcripts (BL-664 substrate + BL-100 usage extraction), derives events, dedupes by `agent:session_id:timestamp` |
| Headless CLI | `extension/src/tools/run-context-telemetry-producer.ts` | One-shot producer run for operators and acceptance |
| Scheduled tick | `swarmforge/scripts/handoffd.bb` | `context-telemetry-producer-sweep!` on the shared sweep cadence — idempotent every tick |
| Write path | `swarmforge/scripts/context_telemetry_cli.bb record` | GH-22 store append — producer never bypasses this |
| Dashboard | GH-23 context budget gate | Read-only; shows data once the store fills |

Backfill is in scope on first run: the walker ingests transcripts that
predate the producer. Re-running over the same window never duplicates records.

## Manual run

```bash
cd extension && npm run compile
node extension/out/tools/run-context-telemetry-producer.js
bb swarmforge/scripts/context_telemetry_cli.bb summary
bb swarmforge/scripts/context_telemetry_cli.bb agents
```

Expect non-empty `summary` / `agents` output naming real roles after at least
one producer pass when transcripts exist.

## Verify

```bash
cd extension && npm test -- contextTelemetryProducer
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-665-context-telemetry-producer-wiring.feature
```

Related: [GH-22 recorder and query CLI](GH-22-context-telemetry-recorder-and-query-cli.md);
[GH-23 context budget dashboard](GH-23-context-budget-dashboard.md).
