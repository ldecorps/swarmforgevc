# Queued questions answer where they were asked (BL-767)

A question typed into a bridge-owned topic (Cursor Remote or Bubble) while
the bridge is busy is acknowledged where it was typed, but until this fix its
eventual answer always posted to the Cursor Remote topic — so a Bubble-asked
question queued, then went quiet in Bubble while the answer appeared on
Cursor Remote instead.

## Behaviour

1. **A queued prompt records the topic it was asked in.** `originTopicId` on
   `CursorBridgeQueuedPrompt` (already used for the BL-810 TTL receipt) is
   now also read at drain time: the answer posts to that topic, falling back
   to the Cursor Remote topic only when no origin was recorded (old state
   files, and the boot-prompt path, which legitimately has none).
2. **A choice-poll answer follows the same rule**, via a new
   `originTopicId` on `CursorBridgeChoicePoll`. Previously a choice-poll
   answer routed to `state.bubbleTopicId ?? state.cursorTopicId` while idle
   (Bubble-first, regardless of where it was posted) and to Cursor Remote
   while busy — two different wrong answers depending on load. Both now
   resolve to the topic the poll was actually answered in.
3. **One shared function, not four independent guesses.** Every
   deferred-reply site resolves its reply topic through
   `resolveDeferredReplyTopicId(originTopicId, cursorTopicId)`
   (`extension/src/tools/telegramCursorBridgeCore.ts`) instead of each
   writing its own fallback — the root cause of the original bug was exactly
   that divergence.
4. **The busy cue follows queued work into its own topic.** A topic other
   than Cursor Remote that is holding queued work gets its own standing,
   edit-in-place `Bridge: busy · N waiting` / `Bridge: idle · 0 waiting`
   line (`queuedWorkLivenessStatus`, `syncQueuedWorkLivenessCues`,
   `extension/src/tools/telegramCursorBridgeLiveness.ts`), so that topic
   doesn't go quiet between the queue ack and the eventual answer. This
   mirrors, per-topic, the existing Cursor Remote-only cue from BL-764 — it
   does not replace it.
5. **A state file written before this change still drains.** A missing
   `originTopicId` is a fallback to Cursor Remote, never a parse failure and
   never a dropped prompt.

## Where it lives

- Shared resolver + persisted-state fields/parsing:
  `extension/src/tools/telegramCursorBridgeCore.ts`
  (`resolveDeferredReplyTopicId`, `CursorBridgeQueuedPrompt.originTopicId`,
  `CursorBridgeChoicePoll.originTopicId`, `queuedWorkLivenessStatus`)
- Deferred-reply call sites: `extension/src/tools/telegramCursorBridgeLive.ts`
  (`sweepExpiredQueuedPrompts`, `processQueuedPollAnswer`,
  `processChoicePollAnswer`)
- Per-topic busy cue: `extension/src/tools/telegramCursorBridgeLiveness.ts`
  (`formatQueuedWorkLivenessLine`, `syncQueuedWorkLivenessCues`)
- Acceptance: `specs/features/BL-767-queued-question-answers-in-origin-topic.feature`,
  step handlers in
  `specs/pipeline/steps/bl767QueuedBridgeQuestionsAnswerInOriginTopicSteps.js`

## Out of scope

- **`pendingPromptPoll` / `processQueuedPollAnswer`'s "choose which queued
  question runs next" poll.** This handler has the same origin-topic fix
  applied for consistency, but nothing in production ever assigns
  `state.pendingPromptPoll` — it has no producer, so the handler cannot fire
  today. Wiring a producer (or removing the dead path) is a separate ticket.
- **BL-764's inbound fan-out.** That queue is the way in and was already
  correct; this fix only touches the way out.
- **The Bubble Android app.** Nothing in `android/` changed — Bubble here is
  the Telegram topic, not the phone client.

## Related

- [Sharing one Telegram bot between the front desk and the Cursor bridge](BL-764-front-desk-shared-token-bridge-fanout.md) —
  the original Cursor Remote-only busy cue this fix adds a per-topic sibling
  to.
- [The Host question queue: selection poll, clear-all, and 72h TTL](BL-810-host-queue-selection-poll-clear-all-and-ttl.md) —
  introduced `originTopicId` on `CursorBridgeQueuedPrompt` for the TTL
  receipt; this fix is what makes the field also drive the actual answer.
