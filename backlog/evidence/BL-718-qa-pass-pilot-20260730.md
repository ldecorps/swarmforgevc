# BL-718 QA pass (cursor-as-expeditor /pilot)

Date: 2026-07-30

## Checks

- Feature scenarios covered by unit tests in `letsTalkBridge.test.js` (short Bubble transcript, shared chunker for long reply, operator event on send failure, choice poll + text, phone turn soft on mirror throw).
- `required_wiring` `extension/src/bridge/bridgeServer.ts::splitTelegram` — `splitTelegramChunks` called inside `mirrorLetsTalkTurnToBubble`.
- Invariants: Bubble-only routing (suppress when Bubble==host), length-independent chunking, loud operator surface, soft phone turn.
- How-to: `docs/how-to/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md`.

## Result

Pass. Ticket moved `backlog/paused` → `backlog/done`.
