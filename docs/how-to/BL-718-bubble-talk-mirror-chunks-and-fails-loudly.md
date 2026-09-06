# How Bubble talk mirror chunks and fails loudly (BL-718)

Successful Let's Talk turns leave a durable **You / Bubble** transcript in the
standing Bubble Telegram topic. The mirror must not dump ordinary talk onto
Host, and it must not silently drop long replies or failed sends.

## Behaviour

1. **Bubble topic when bound** — `mirrorLetsTalkTurnToBubble` posts to the bound
   Bubble topic (`bubbleTopicId` / topic-map `BUBBLE`) via
   `effectiveLetsTalkMirrorTopicId`. When Bubble is unbound, the mirror falls
   back to **Host** (BL-709 scenario 07). When Bubble and Host
   share the same id, treat Bubble as unbound — never duplicate into the host
   topic.
2. **Shared chunker** — text is split with `splitTelegramChunks` (same helper
   Host uses). Length alone never truncates a transcript.
3. **Fails loudly** — when a chunk send returns `success: false` after retries,
   the bridge logs and appends an operator event
   `type: bubble-talk-mirror-failed` (topic, chunk index, error). The phone
   turn still succeeds; mirror failure is soft relative to the spoken reply.
4. **Choice polls** — after text chunks succeed, choice-poll extraction still
   mirrors a poll into Bubble.

## Where it lives

- Mirror orchestration: `extension/src/bridge/bridgeServer.ts` →
  `mirrorLetsTalkTurnToBubble`, `mirrorLetsTalkChoicePollToBubble`
- Topic routing (BL-744): `extension/src/bridge/bubbleMirrorTopic.ts` →
  `mergeTopicId`, `readCursorBridgeTopicIds` (state file vs topic-map merge)
- Pending poll state (BL-744): `extension/src/bridge/bubbleMirrorState.ts` →
  `appendPendingChoicePoll`
- Delivery helpers (BL-744): `extension/src/bridge/bubbleMirrorDelivery.ts`
- Chunker: `extension/src/tools/telegramCursorBridgeCore.ts` →
  `splitTelegramChunks`, `buildPersistedState` (`bubbleTopicId` branch)
- Tests: `extension/test/letsTalkBridge.test.js` (BL-718 cases),
  `extension/test/bl744TopicMergeHelpers.test.js` (topic-merge branch coverage)
- Acceptance: `specs/features/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.feature`

## Out of scope

Hold music / TTS / silent-return (BL-717), barge-in, merging Bubble with Cursor
Remote.

## Property rigor (BL-738)

The live property that encodes length-independent reassembly must exercise the multi-chunk branch. See [BL-738](BL-738-chunking-property-reaches-the-split-boundary.md) — probe `maxLen` + generator floor, not hand-synced 4096 inputs.
- APS steps: `specs/pipeline/steps/bl718BubbleTalkMirrorSteps.js` (wired by
  BL-726 — see [BL-726](BL-726-bl718-acceptance-feature-has-no-step-handlers.md))
