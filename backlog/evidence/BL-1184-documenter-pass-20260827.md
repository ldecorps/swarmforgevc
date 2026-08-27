# BL-1184 — documenter pass — 20260827

**Received:** `merge_and_process hardender 803b4f038b` (handoff
`00_20260827T182548Z_000899_from_hardender_to_documenter`)
**Merged at:** merge --no-ff `803b4f038b`
**Task:** BL-1184-briefing-shift-velocity

## What changed (user-visible)

A third rendered chart in the morning briefing email: "Shift velocity — max
tickets landed per 8h," a non-linear-time-axis line chart alongside the
existing architecture diagrams and open-ticket burndown chart. New CLI
`render-briefing-shift-velocity.js`; new optional telemetry log
`shift-velocity-YYYY-MM.jsonl`.

## Doc surfaces updated

- New how-to: `docs/how-to/BL-1184-briefing-shift-velocity-chart.md` —
  metric definition (max rolling 8h landed per day), data source (shared
  `deriveTicketLifecycles`, no second reader), the logarithmic non-linear
  time axis, the telemetry capture, and the fail-open contract.
- `docs/how-to/BL-896-briefing-open-ticket-chart.md` — updated its
  "Fail-open independence" section from "two diagram sources" to name the
  third (shift-velocity), since `diagram-section-from-sources` gained a
  third optional source parameter this ticket.
- `docs/index.md` — linked the new how-to in the same commit.

## Doc surfaces checked, no change needed

- `docs/reference/Specification.MD` — grepped for `briefing`/`burndown`;
  BL-896's chart was never mirrored there either (only `docs/index.md` +
  its own how-to), so no precedent to update for this sibling chart.
- `docs/diagrams/` (architecture + swarm-workflow) — this ticket adds a
  pure metrics/render module and a `handoffd.bb` shell-out, no new
  extension-host/webview/tmux component or pipeline-topology change.
- `deliveryMetrics.ts` / `notDoneBurndownChart.ts` changes (cleaner's DRY
  extraction of `briefingChartSvgCommon.ts`, and a convenience re-export)
  are behavior-preserving internal refactors — no doc-visible surface.

## Forward

`git_handoff` → QA, priority `00`, task `BL-1184-briefing-shift-velocity`.

By documenter.
