# Reading self-heal event trends (BL-597)

*How-to. Task-oriented: see whether the swarm's automatic recoveries are
spiking — stale-build recompiles, respawns, kill_all, rotations, claim-heal.*

A healthy swarm self-heals rarely. A rising recompile or respawn rate is an
early warning of instability before it becomes a visible outage.
**Measurement only** — this does not change recovery behaviour.

## Where the log lives

```text
.swarmforge/telemetry/self-heal-<YYYY-MM>.jsonl
```

Append-only, one JSON object per line. Gitignored (`.gitignore` +
`.swarmforge/`). Emit failures are swallowed so an unwritable path never
blocks self-heal.

## Event types

| Type | What it counts |
| --- | --- |
| `stale-build-recompile` | Front-desk supervisor recompile before respawn |
| `supervisor-respawn` | Bounded supervisor restart (`:started`) |
| `kill-all-swarm` | `kill_pipeline_swarm` / clean-slate success |
| `rotation-respawn` | Mono-router persona swap respawn |
| `claim-heal` | handoffd resume of orphaned `in_process` |

Each event is `{type, subject, reason, at}` and is appended **at the same
site** that already logs the prose line — no second detector.

## Where it lives

| Piece | Location |
| --- | --- |
| Append (Clojure) | `swarmforge/scripts/self_heal_telemetry_lib.bb` |
| Pure aggregator | `extension/src/metrics/selfHealTelemetry.ts` → `aggregateSelfHealCounts` → `trend.ts` |
| Store helpers / tests | `extension/src/metrics/selfHealTelemetryStore.ts` |
| Acceptance | `specs/features/BL-597-trend-self-heal-events.feature` |

## Operator check

```bash
ls .swarmforge/telemetry/self-heal-*.jsonl
tail -n 20 .swarmforge/telemetry/self-heal-$(date -u +%Y-%m).jsonl
```

A spike in one type (e.g. many `stale-build-recompile` in an hour) is the
signal — dig the matching prose log / subject next.

## Verify

```bash
cd extension && npm test -- selfHealTelemetry
bb swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-597-trend-self-heal-events.feature
```

Related: [Reading front-desk human-loop reliability trends](BL-595-trend-human-loop-reliability.md),
epic BL-594 swarm-behaviour-trends. BL-1273 restored the five production
emit sites above after a merge (2e37477ec) silently dropped them 58 minutes
after BL-597 landed; the sites and this doc's claim were both dark between
2026-08-27 and 2026-08-29 and are both correct again as of BL-1273.
