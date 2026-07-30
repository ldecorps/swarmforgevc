# How to read /pilot Telegram status posts (BL-700)

When `/pilot` runs on Cursor Remote, the agent must post structured status
to the topic — not only refresh `progress.json` or playful SDK status.

## Mandatory posts

1. **Ticket change** (start, switch, handoff) — ticket id + object summary
   (title / one-line purpose from YAML). Helper:
   `formatPilotTicketChangeStatus`.
2. **Hat / casquette change** — role now worn + brief stage job. Helper:
   `formatPilotHatChangeStatus`.
3. **Bounce-back** — target role **and** explicit reason. Helper:
   `formatPilotBounceBackStatus`.

Optional short posts for interesting non-vacuous scenarios are allowed.

## Human questions

Still use a native Telegram poll on Cursor Remote (BL-699 rule). Free-text-only
asks are not enough.

## Where it lives

- Prompt + helpers: `extension/src/tools/telegramCursorBridgePilot.ts`
- Tests: `extension/test/telegramCursorBridgePilot.test.js`
- Acceptance: `specs/features/BL-700-pilot-telegram-status-posts.feature`
