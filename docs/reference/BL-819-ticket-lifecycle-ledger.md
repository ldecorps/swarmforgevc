# BL-819: Ticket Lifecycle Ledger

A durable, coordinator-owned, append-only record of what happened to each
ticket as it moved through the pipeline — stages entered, dwell per stage,
bounces, stage skips, stalls, and the close outcome — composed entirely from
instruments that already ship. This is a first-class **duty** of the existing
coordinator, not a ninth standing agent: the coordinator records and reports,
it does not gain any new power over promotion or gating from this (unchanged:
its Swarm Optimizer duty — see [Backlog Management](../../swarmforge/constitution/articles/03_backlog.md) — and
[Health-Based Intake Throttling](../../swarmforge/constitution/articles/03_backlog.md)).

## Reuse before invent

Every field traces to an instrument that already records it — nothing here
is computed, inferred, or narrated by an LLM. A field with no existing
source is dropped from this ledger rather than given a new writer:

| Ledger event `type` | Composed from (`source`) | Existing instrument |
|---|---|---|
| `stage_transition` | `stage-dwell` | The handoff audit headers already stamped on every parcel (`enqueued_at`, `dequeued_at`, `completed_at`) |
| `bounce` | `bounce-store` | The ticket YAML's own `bounce_count`/`bounce_history`, written by `record-bounce` (`extension/src/tools/record-bounce.ts`) |
| `stage_skip` | `routing-skip-log` | The ticket's own `required_stages` and `stage_skip_reasons` |
| `stall` | `chaser-telemetry` | `handoffd`'s existing chase/nudge telemetry |
| `close` | `backlog-close` | The backlog folder transition (`backlog/active/` → `backlog/done/`) and its landing commit |

## Storage

- **Ledger file:** `.swarmforge/lean/<yyyy-MM-dd>.jsonl` — one
  `LeanLedgerEvent` JSON object per line, bucketed by calendar day (the same
  granularity `bounceStore.ts`/the cost-health sidecar already use; see
  `leanLedgerStore.ts`'s header for why day-bucketing was chosen over a
  shift boundary that doesn't exist yet as a computable hook).
- **Per-ticket snapshot:** a pure fold of that ticket's own events, refreshed
  on every write. The JSONL stays the only writer — the snapshot is never an
  independent source of truth.

### Event shape

```ts
interface LeanLedgerEvent {
  ticket: string;
  type: 'stage_transition' | 'bounce' | 'stage_skip' | 'stall' | 'close';
  source: 'stage-dwell' | 'bounce-store' | 'routing-skip-log' | 'chaser-telemetry' | 'backlog-close';
  at: string;        // ISO 8601, copied verbatim from the source instrument — never generated at compose time
  role?: string;      // the pipeline role this event concerns, when the instrument names one
  data: Record<string, string | number | null>;
}
```

`data`'s allowed keys are a **closed set per source** (`KNOWN_LEAN_LEDGER_DATA_KEYS`
in `extension/src/quality/leanLedger.ts`) — an event carrying a key outside
its own source's list fails shape validation, so nothing can smuggle in a
computed or narrated field under an innocuous-looking key.

### Per-ticket snapshot

A pure fold (`foldLeanLedgerSnapshot`) over one ticket's events:

```ts
interface LeanLedgerSnapshot {
  ticket: string;
  stagesEntered: string[];       // roles, first-seen order, deduped
  dwell: LeanLedgerStageDwell[]; // { role, queueWaitMs, processingMs, at }
  bounceCount: number;
  bounces: LeanLedgerBounce[];   // { at, by?, blamedRole?, failureClass?, commit?, evidence? }
  skips: LeanLedgerStageSkip[];  // { role, reason, at }
  stalls: LeanLedgerStall[];     // { role, eventType, count, at }
  closed: boolean;
  closedAt: string | null;
}
```

## Idempotency

Every field of a composed event is a verbatim copy of an already-fixed fact
(a handoff's own `completed_at`, a bounce record's own `at`/`commit` — never
"now"), so re-running composition over the same underlying state produces a
byte-identical event. The full event (with `data` keys sorted for stable
ordering) is the natural key (`leanLedgerEventNaturalKey`); appending an
event whose natural key already exists in the day's file is a no-op. This
holds under a hook re-run, a redelivered parcel, or a daemon restart
mid-write.

## Write points

Recorded via a single CLI, `node extension/out/tools/lean-ledger-record.js
--ticket <id> [--target <path>]`, which composes all five instruments for
one ticket, idempotently appends whatever is new, and refreshes that
ticket's snapshot. Shelled from the two points in the pipeline that already
mark ticket progress — no new lifecycle hook was added:

- `done_with_current_task.bb` — every handoff completion
- `commit_integrity_cli.bb` — the close-commit path

Both call sites are best-effort and silent when `extension/out/` isn't built
at the target (an arbitrary managed project never carries this repo's own
compiled tools) — a `lean-ledger-record-warn:` log line records the skip, it
never blocks the ticket's actual handoff or close.

## Boundary: what this duty is not

This ledger records; it does not narrate, gate, or decide. Recording is
separable from the closing-ceremony consumer that will eventually read it —
that consumer is a later slice (BL-820), blocked on a shift-close hook that
does not exist yet. Until then, the ledger accumulates real data from the
moment it lands, so the eventual ceremony has history to read instead of
starting empty.

This duty does not change, replace, or extend:

- **The coordinator's Swarm Optimizer duty** — promotion order, orthogonality
  checks, and intake throttling are unchanged; nothing here gives the
  coordinator a new power over gating.
- **The daily human briefing** (`docs/briefings/<date>.md`/`.json`) — a
  separate, already-shipping narrative layer built from its own cost-health
  sidecar composition, not from this ledger.
- **QA, the hardener, or babysitterd** — this ledger is a passive record of
  facts those roles/daemons already produce; it does not replace any of
  their checks.

## See also

- [Ticket Lifecycle Ledger source: `extension/src/quality/leanLedger.ts`](../../extension/src/quality/leanLedger.ts) — the pure event/snapshot core.
- [`extension/src/metrics/leanLedgerCompose.ts`](../../extension/src/metrics/leanLedgerCompose.ts) — the per-instrument composers.
- [`extension/src/metrics/leanLedgerStore.ts`](../../extension/src/metrics/leanLedgerStore.ts) — the JSONL/snapshot read-write layer.
