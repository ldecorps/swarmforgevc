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
| Scheduled tick | `swarmforge/scripts/handoffd.bb` | `context-telemetry-producer-sweep!` on the shared sweep cadence — idempotent every tick; a non-zero exit is logged as `context-telemetry-producer-failed` with the exit code and first stderr line, so a failing tool no longer leaves only the sweep-boundary line behind (BL-1478) |
| Write path | `swarmforge/scripts/context_telemetry_cli.bb record-batch` | GH-22 store append, one subprocess per tick (BL-1477) — producer never bypasses this |
| Dashboard | GH-23 context budget gate | Read-only; shows data once the store fills |

Backfill is in scope on first run: the walker ingests transcripts that
predate the producer. Re-running over the same window never duplicates records.

## Torn-tail tolerance, cap and deadline (BL-1477)

An unclean host shutdown can leave the store's final line torn (NUL bytes,
or an unfinished record with no trailing newline). Both the TS reader
(`readPersistedContextEvents`) and the bb reader
(`context_telemetry_store.bb`'s `read-events!`) treat a torn **final** line
the same way: NUL bytes are stripped before parsing, and if the line is
still unparseable and nothing whole follows it, it is dropped and named
(never treated as damage). An unparseable line with a whole line **after**
it is interior damage — the store is the dedupe cursor, so both readers
refuse to read at all rather than record or summarize against a cursor
that might duplicate; the producer exits non-zero naming the line, and the
CLI's `summary`/`agents` commands do the same on stderr.

Each tick records at most a capped batch, oldest first, and stops once the
tick's deadline has passed (an event already started when the deadline
hits still finishes) — never all outstanding events in one tick, since
that could run one 60 s-bounded subprocess call per event. The remainder
is picked up by later ticks, never re-recorded (the dedupe key is honoured
across ticks):

| Env var | Default | Meaning |
| --- | --- | --- |
| `CONTEXT_TELEMETRY_TICK_CAP` | 500 | Max events recorded per producer tick |
| `CONTEXT_TELEMETRY_TICK_DEADLINE_MS` | 30000 | Max time spent recording per tick, clamped to ≤ ¼ of `SUPERVISOR_IN_SWEEP_BUDGET_MS` |

The producer writes to the store via `context_telemetry_cli.bb
record-batch` (JSONL events piped over stdin, one `bb` subprocess per
tick) rather than one `record` call per event — the per-event subprocess
cost is what silently starved the daemon's wait bound while the store was
dark. The writer also guarantees the file ends in a newline before every
append, so a tolerated torn tail never becomes interior damage on the next
write.

`run-context-telemetry-producer`'s output line names how many events were
recorded, for how many agents, how many remain for a later tick, and
whether a torn tail was dropped this run (e.g. `RECORDED 500 event(s) for
6 agent(s), 1200 remaining (torn tail dropped at line 234113)`).

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
