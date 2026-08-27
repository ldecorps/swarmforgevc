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

## SPEC-GAP: pre-QA `required_wiring` gate fails on the ticket's own field

Committed the doc pass (`d8017e37b2`) and attempted `git_handoff` → QA;
`swarm_handoff.sh` refused it (`HANDOFF INVALID`, exit 2) via
`PRE_QA_GATE_FAIL wiring`, three of the four `required_wiring:` rows in
`backlog/active/BL-1184-briefing-shift-velocity.yaml`:

```
required_wiring:
  - "extension/src/metrics/ deliveryMetrics or shiftVelocity::8h landed counts::git and/or telemetry"
  - ".swarmforge/telemetry/shift-velocity-*.jsonl::optional forward capture::append-only if no existing series"
  - "briefing burndown/email path::shift velocity chart::non-linear time axis"
  - "specs/pipeline/steps/index.js::bl1184BriefingShiftVelocitySteps::acceptance handler registered"
```

`pre_qa_gate_lib.bb`'s `parse-wiring-entry` takes everything before the
first `::` as a **literal** file path, looked up verbatim in a
git-tracked-content map at the cited commit. Only row 4 is a real,
resolvable path (and it passes — `bl1184BriefingShiftVelocitySteps` is
registered in `specs/pipeline/steps/index.js`, confirmed by hand). The other
three are unsatisfiable as written:

- Row 1's "path" is prose — `"extension/src/metrics/ deliveryMetrics or
  shiftVelocity"` (with a stray space and an "or") — not
  `extension/src/metrics/shiftVelocity.ts`. The literal string never matches
  a tracked file, regardless of what the file contains. (Confirmed by hand:
  `extension/src/metrics/shiftVelocity.ts` exists and correctly derives 8h
  landed counts from `deriveTicketLifecycles`/`runGitLog` only.)
- Row 2's glob `.swarmforge/telemetry/shift-velocity-*.jsonl` names a
  runtime-generated, gitignore-pattern file (siblings
  `mutation-runs.jsonl`/`rotation-*.jsonl` are already gitignored in this
  repo) — it can never be a tracked file at any commit, and the row's own
  wording ("optional ... if no existing series") concedes the file may
  legitimately not exist. A required-wiring row that can never resolve for
  an explicitly optional behavior is self-contradictory as authored.
- Row 3's "path" is prose — `"briefing burndown/email path"` — not
  `swarmforge/scripts/handoffd.bb` or `swarmforge/scripts/briefing_email_lib.bb`
  (confirmed by hand: `briefing-shift-velocity-json` in `handoffd.bb` and the
  three-source `diagram-section-from-sources` + `"shift-velocity"` heading
  in `briefing_email_lib.bb` are both correctly wired).

This is a ticket-authoring defect (malformed `required_wiring:` syntax),
not a code or documentation defect — the underlying wiring the rows
describe is real and correct in all three cases; only the field's syntax
keeps the gate from seeing it. No earlier stage's own gates exercise
`pre_qa_gate_lib.bb`'s wiring check (it only runs inside
`swarm_handoff.sh` at the documenter→QA hop), so this is the first point in
the pipeline where the defect surfaces. Not documenter's or QA's domain to
rewrite ticket fields — sent as a spec-gap `note` (priority `00`) to
specifier + coordinator per Article 4.4, not a parcel bounce.

**Not forwarded to QA this turn** — parked pending specifier's amendment of
the three malformed `required_wiring:` rows.

By documenter.
