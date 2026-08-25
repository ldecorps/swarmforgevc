# Reading front-desk human-loop reliability trends (BL-595)

The Telegram front desk appends reliability events to an append-only ledger so
you can see approval-tap success, steering delivery, poll degradation / 409s,
and concierge tick duration over time — the leading indicators that were
missing when silently failing taps (BL-582) stayed invisible for hours.

**This only measures.** It does not fix tap or steer failures.

## Where the log lives

```text
.swarmforge/telemetry/human-loop-<YYYY-MM>.jsonl
```

One JSON object per line. Covered by `.swarmforge/` in `.gitignore` (same
posture as `context-events.jsonl` and the availability ledger).

## What each series records

| Series | What lands |
|--------|------------|
| `approval-tap` | `recorded`, `silently-dropped` (+ `reason`), or `repaint-failed` |
| `steering-delivery` | `delivered`, `no-pane`, `undelivered`, or `menu-blocked` |
| `poll-health` | `degraded` or `conflict-409` when the poll cycle warns |
| `tick-duration` | `durationMs` wall-clock for each concierge tick |

Outcomes are those the front-desk code already computed — the ledger never
re-classifies.

## Operator checks

```bash
# Tail this month's ledger (create a few taps / steers first on a live desk)
ls .swarmforge/telemetry/human-loop-*.jsonl
tail -n 20 .swarmforge/telemetry/human-loop-$(date -u +%Y-%m).jsonl
```

Emit is async and non-blocking: an unwritable ledger path must not fail the
front desk. Aggregation for trends is pure over in-memory records
(`humanLoopReliability.ts` → `trend.ts`); it does not re-read files on its own.

## Related

- [Steering a swarm role from Telegram](BL-566-steer-a-role-from-telegram.md)
- [Answering a menu-blocked pane](BL-568-menu-blocked-pane-questions-as-mapped-polls.md)
- Spec section: **Human-Loop Reliability Ledger (BL-595)** in
  [Specification](../reference/Specification.MD)

Acceptance:
`specs/features/BL-595-human-loop-reliability-trend.feature`
