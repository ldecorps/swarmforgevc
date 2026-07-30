# BL-699 QA pass (cursor-as-expeditor /pilot) — 2026-07-29

## Scope check
Prompt-only retune of `composePilotExpeditorPrompt`. No sibling-intake expansion.

## Evidence
- Feature: specs/features/BL-699-pilot-quality-bounce-backs.feature (5 scenarios)
- Unit tests: extension/test/telegramCursorBridgePilot.test.js — 9/9 pass
- How-to: docs/how-to/BL-699-pilot-quality-bounce-backs.md
- Commits on expedite/BL-699: a62d8c376 (coder), 4ea28a57f (documenter)

## Invariants held
- /pilot distinct from /expedite; expedite lock gate unchanged
- Bounce-backs with rationale; no paper-over / QA rush
- Human questions → Telegram poll on Cursor Remote (prompt rule)
