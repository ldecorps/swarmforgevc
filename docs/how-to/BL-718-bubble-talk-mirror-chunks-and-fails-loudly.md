# How Bubble talk mirror chunks and fails loudly (BL-718)

Successful Let's Talk turns leave a durable **You / Bubble** transcript in the
standing Bubble Telegram topic. The mirror must not dump ordinary talk onto
Cursor Remote, and it must not silently drop long replies or failed sends.

## Behaviour

1. **Bubble topic only** — `mirrorLetsTalkTurnToBubble` posts to the bound
   Bubble topic (`bubbleTopicId` / topic-map `BUBBLE`). If Bubble is unbound or
   identical to Cursor Remote, the mirror skips (no host-topic dump).
2. **Shared chunker** — text is split with `splitTelegramChunks` (same helper
   Cursor Remote uses). Length alone never truncates a transcript.
3. **Fails loudly** — when a chunk send returns `success: false` after retries,
   the bridge logs and appends an operator event
   `type: bubble-talk-mirror-failed` (topic, chunk index, error). The phone
   turn still succeeds; mirror failure is soft relative to the spoken reply.
4. **Choice polls** — after text chunks succeed, choice-poll extraction still
   mirrors a poll into Bubble.

## Where it lives

- Mirror: `extension/src/bridge/bridgeServer.ts` → `mirrorLetsTalkTurnToBubble`
- Chunker: `extension/src/tools/telegramCursorBridgeCore.ts` → `splitTelegramChunks`
- Tests: `extension/test/letsTalkBridge.test.js` (BL-718 cases)
- Acceptance: `specs/features/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.feature`

## Out of scope

Hold music / TTS / silent-return (BL-717), barge-in, merging Bubble with Cursor
Remote.
