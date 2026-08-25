# Reading false-alarm rate trends on alerts (BL-598)

Self-cancelling alerts (AGENT_EXITED false positives, steady-state
`active-backlog-depth` warnings under a cap-of-1, and similar NO-OP noise)
now append to an append-only ledger with the verdict the emitting sweep
already assigned — so "the logs are noisy" becomes a per-type false-positive
rate you can trend down over time.

**This only measures.** It does not suppress or rewrite the underlying alerts.

## Where the log lives

```text
.swarmforge/telemetry/alerts-<YYYY-MM>.jsonl
```

One JSON object per line (`at`, `alertType`, `verdict`, `fired`). Gitignored
under `.swarmforge/` (same posture as the human-loop ledger in BL-595).

## What gets recorded

| Source | Typical verdict |
|--------|-----------------|
| `swarm_handoff.bb` depth warning (BL-562 steady state) | `false-positive` |
| Operator / sweep paths via `emit-alert-telemetry.js` | `false-positive` or `actionable` |

Verdicts are never re-judged at write or aggregate time — aggregation is pure
in `alertTelemetry.ts` → `trend.ts`.

## Operator checks

```bash
# Tail this month's alert ledger
ls .swarmforge/telemetry/alerts-*.jsonl
tail -n 20 .swarmforge/telemetry/alerts-$(date -u +%Y-%m).jsonl

# Append one record manually (after compile)
node extension/out/tools/emit-alert-telemetry.js "$(pwd)" my-alert-type false-positive
```

Emit is best-effort: a missing CLI or unwritable path must not block
`swarm_handoff` or other alert sources.

## Related

- [Reading front-desk human-loop reliability trends](BL-595-trend-human-loop-reliability.md)
- Spec section prepended under **Last Updated** for BL-598 in
  [Specification](../reference/Specification.MD)

Acceptance: `specs/features/BL-598-trend-false-alarm-rate.feature`
