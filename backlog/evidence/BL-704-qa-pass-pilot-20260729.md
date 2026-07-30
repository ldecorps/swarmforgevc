# BL-704 QA pass (cursor-as-expeditor /pilot) — 2026-07-29

## Scope check
Slice 3 of BL-698: shift/holiday/oncall policy under .swarmforge/operator/,
holiday Run anyway for pilot + expedite + batch verbs, /oncall named on
ensure replies, documenter how-to + Mermaid + cross-links from BL-696 docs.

## Evidence
- Feature: specs/features/BL-704-operator-shifts-holidays-docs.feature
- How-to: docs/how-to/BL-698-telegram-cursor-operator-commands.md
- Diagrams: docs/diagrams/cursor-remote-flow.mmd,
  docs/diagrams/operator-command-surface.mmd
- Modules: telegramCursorOperatorPolicy.ts; Live holiday gates on pilot +
  expedite; ensure oncall line
- Unit tests (2026-07-29 focused):
  - telegramCursorOperatorQueue.test.js — holiday/shift/oncall helpers
  - telegramCursorOperatorExec.test.js — durable policy round-trip via execute
  - Combined focused run: 267/267 pass (with BL-702/703 suite)

## Scenario map
| Scenario | Coverage |
|----------|----------|
| Holiday refuse + Run anyway | formatHolidayRefuse + runAnywayButtons; expedite path |
| Shift/holiday durable state | executeOperatorVerb write/read operator-policy.json |
| /oncall me | applyOncall + ensure formatOncallAlertLine |
| How-to + diagrams exist | files present; how-to links reference spec + diagrams |
| BL-696 cross-links | miniapp how-to + amendment → BL-698 how-to |

## Invariants held
- Holiday refuse offers Run anyway for pilot/expedite/autopilot/land/hydrate/mint
- Policy state only under .swarmforge/operator/
- Documenter deliverables for BL-698 shipped
