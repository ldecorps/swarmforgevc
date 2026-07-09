# backlog.json schema

BL-097: `backlog.json` is a stable, versioned data contract published to
GitHub Pages by `.github/workflows/backlog-dashboard.yml`. It is generated
by `node out/tools/generate-backlog-dashboard.js` (source:
`extension/src/metrics/backlogDashboard.ts`), which is a thin presenter over
the same `computeDeliveryMetrics` the `swarm-metrics` CLI and the bridge's
`/metrics` endpoint use — the numbers here always agree with those surfaces
at the same commit.

Additive evolution only within `schemaVersion` 1: new optional fields may be
added without a version bump; removing or repurposing a field requires
bumping `schemaVersion` and documenting the change here.

## Top level

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Currently `1`. |
| `generatedAtIso` | string (ISO 8601) | When this file was generated. |
| `sourceSha` | string \| null | The commit this projection was generated from. `null` only if `git rev-parse HEAD` itself failed (should not happen in the Action). |
| `board` | object | See **Board** below. |
| `metrics` | object | See **Metrics** below. Test-suite duration is deliberately absent: its records (`extension/.test-durations.jsonl`, BL-078) are gitignored/machine-local, so no git-derived projection can see them. |

## Board

| Field | Type | Notes |
|---|---|---|
| `board.active` | `TicketSummary[]` | Tickets currently in `backlog/active/`. |
| `board.paused` | `TicketSummary[]` | Tickets currently in `backlog/paused/`. |
| `board.doneByMilestone` | `Record<string, TicketSummary[]>` | Tickets in `backlog/done/`, grouped by milestone; a ticket with no `milestone:` field is grouped under the key `"unspecified"`. |

### TicketSummary

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `"BL-097"`. |
| `title` | string | |
| `status` | `"active" \| "paused" \| "done"` | The folder this ticket currently sits in (authoritative over any `status:` field inside the ticket YAML). |
| `swarm` | string | The ticket's `swarm:` field (BL-090), defaulting to `"primary"` when absent. |
| `milestone` | string (optional) | Absent if the ticket has no milestone. |
| `priority` | number (optional) | Absent if the ticket has no priority. |
| `specDateIso` | string (optional) | Earliest git-recorded arrival of this ticket's file anywhere under `backlog/`. Absent if git history doesn't show one (e.g. not yet committed). |
| `closeDateIso` | string (optional) | Earliest git-recorded arrival under `backlog/done/`. Present only once a ticket has actually closed. |
| `p50Iso` / `p85Iso` | string (optional) | Delivery-date forecast (BL-096) for a still-open ticket, count-based estimates. Absent for closed tickets, and absent for any ticket the forecaster has no data for (e.g. zero historical throughput). |

## Metrics

Each field is the corresponding `DeliveryMetrics` field from
`extension/src/metrics/deliveryMetrics.ts`, passed through unmodified:

| Field | Type | Notes |
|---|---|---|
| `metrics.velocity` | `VelocityResult` | Weekly closed-ticket series, trend (BL-096's shared trend function), and a trailing-window rolling count. |
| `metrics.burndown` | `MilestoneBurndownResult[]` | Per-milestone remaining-count series reconstructed from git history; the final point always matches the current backlog folder state. |
| `metrics.cycleTime` | `CycleTimeResult` | Median/p85 spec-to-close duration over the recent closed set, plus a weekly series and trend. |
| `metrics.forecasts` | `ForecastResult` | Per-ticket and per-milestone p50/p85 delivery-date estimates (trailing throughput + historical cycle-time distribution, depends_on-aware — see `deliveryMetrics.ts`'s own comments for the method). |

See `extension/src/metrics/trend.ts`'s `TrendResult` and
`extension/src/metrics/deliveryMetrics.ts`'s own exported interfaces for the
exact nested shapes (`TrendSeriesPoint`, `MilestoneBurndownResult`, etc.) —
this document tracks the top-level contract; the TypeScript interfaces are
the source of truth for nested field names.

## What is NOT in this file

- Test-suite duration trend (gitignored/local-only — see above).
- Per-role CPU/RAM/cost telemetry (BL-100) — local-only data, not published.
- The "optimizer card" briefing sidecar (BL-213, not yet built) — the PWA
  hides that card entirely when no sidecar is present; nothing in
  `backlog.json` itself carries it.
