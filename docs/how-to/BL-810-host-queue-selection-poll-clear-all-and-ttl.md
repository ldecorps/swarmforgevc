# The Host question queue: selection poll, clear-all, and 72h TTL (BL-810/BL-811/BL-894)

Questions typed to the Host bridge (Cursor Remote / Bubble) while it is busy
are queued rather than dropped. This is how that queue is drained — by pick,
by clear-all, or by age — the safety fix (BL-811) that keeps a stray vote
from wiping it, and the explicit-repost behaviour (BL-894) for when a poll
has scrolled off the topic.

## Behaviour

1. **The queue presents itself.** As soon as the Host bridge finishes a turn
   with questions still queued, the next poll loop tick posts a queue
   selection poll to the Host topic — the human is not required to type
   `/queue` first. At most one such AUTOMATICALLY-posted poll is ever
   outstanding at a time (a re-presentation offering the same head never
   double-posts).
2. **`/queue` always reposts a fresh poll, on purpose.** Typing `/queue`
   posts a brand-new selection poll even if one is already outstanding —
   the point is to summon back a poll that scrolled off the topic. This is
   a deliberate, narrow exception to point 1's one-outstanding-poll rule,
   scoped to this explicit human request only (see BL-894). The poll it
   replaces is *superseded*, not deleted: it stays visible in Telegram but
   is no longer live.
3. **Voting a superseded poll never falls through in silence.** If the
   human votes on a poll that a later `/queue` repost superseded, the reply
   is `That poll is no longer live — send /queue again to see the current
   one.` — never a silent no-op. This holds across any number of reposts:
   the bridge remembers a bounded history of superseded poll ids
   (`supersededPromptPollIds`, capped at 8), not just the single most
   recent one, so a vote on an *older* superseded poll (two or more
   reposts back) still gets the same reply instead of matching nothing.
4. **Selecting a question runs only that one.** Voting for a listed question
   sends it to the Host agent as the next turn and removes it from the queue;
   the rest stay queued.
5. **Clear-all empties the queue without starting a run.** A non-empty queue's
   poll always carries a trailing clear-all option. Voting it drops every
   queued question and posts a receipt naming what was cleared — no turn
   starts.
6. **A stale poll is replaced, not left to starve later arrivals.** If the
   queue's head changes after a poll goes out (new items queued, items
   removed elsewhere), the outstanding poll is dropped (superseded, same as
   an explicit `/queue` repost) so the next idle tick posts a fresh one
   offering the current head. This is the fix for the original starvation
   bug: items queued after a poll went out used to wait behind it
   indefinitely.
7. **Old questions expire after 72 hours (`QUEUED_PROMPT_TTL_MS`).** A sweep
   drops any queued question older than the retention window and posts a
   receipt naming how many were dropped and their age span — nothing vanishes
   silently. Expired items are never offered in a poll and never sent to the
   Host agent.
8. **A TTL receipt lands in the topic the question came from.** Each queued
   item remembers its origin topic (`originTopicId`); an item with no
   recorded origin receipts to the Host topic instead.
9. **`/queue` never redefines the Host topic.** The Host topic
   (`cursorTopicId`) is bound once, by the bridge's own canonical binding
   path — never by whichever topic a `/queue` command happens to arrive
   from. Typing `/queue` from a topic other than Host reposts the poll to
   the already-bound Host topic; it cannot adopt a stray topic as the new
   Host topic (BL-894 P3).
10. **Votes still ride the front desk's existing fan-out** (BL-764) —
   `poll_answer` updates reach the bridge the same way any other Host/Bubble
   update does; this feature adds no second transport.

## Safety: a vote retraction never wipes the queue (BL-811 D1)

Telegram sends `option_ids: []` when a human retracts their vote on a
non-anonymous poll. A poll persisted by a build older than this fix has no
`clearAllOptionIndex` field, so a naive comparison could read the retraction
as a vote for a clear-all option that was never really selected — silently
emptying the whole queue.

The decision is now made by a single pure function,
`decideQueuedPollAnswerAction` (`extension/src/tools/telegramCursorBridgeCore.ts`),
which requires `clearAllOptionIndex` to be a real number before treating a
vote as clear-all. A retraction against a poll with no `clearAllOptionIndex`
is ignored: the queue and the outstanding poll are left untouched.

## Where it lives

- Poll posting / stale-poll clearing / TTL sweep / vote handling:
  `extension/src/tools/telegramCursorBridgeLive.ts`
  (`postQueueSelectionPoll`, `clearQueuedPollIfStale`,
  `sweepExpiredQueuedPrompts`, `processQueuedPollAnswer`)
- `/queue` explicit repost (BL-894): `telegramCursorBridgeLive.ts`
  (`handleQueueInboundAction`, `appendSupersededPollId`); the bounded
  superseded-id history lives on `CursorBridgePersistedState.
  supersededPromptPollIds`
- Pure poll-answer decision (BL-811 fix):
  `extension/src/tools/telegramCursorBridgeCore.ts`
  (`decideQueuedPollAnswerAction`)
- Acceptance: `specs/features/BL-810-host-queue-selection-poll-clear-all-and-ttl.feature`,
  step handlers in `specs/pipeline/steps/bl810HostQueuePollClearAllTtlSteps.js`
- The `/queue` repost behaviour has its own sibling acceptance file,
  `specs/features/BL-894-queue-reposts-selection-poll.feature`
  (step handlers: `specs/pipeline/steps/bl894QueueRepostsSelectionPollSteps.js`),
  driving the same `runCursorBridgePollOnce` surface as the file above

## Out of scope

- New queue features beyond this hotfix (reordering, bulk run, new UI).
- Renaming Cursor Remote to Host (BL-725).
- Broader refactors of queue architecture unrelated to starvation.

## Related

- [Sharing one Telegram bot between the front desk and the Cursor bridge](BL-764-front-desk-shared-token-bridge-fanout.md) —
  the `poll_answer` fan-out this feature rides.
- [Queued questions answer where they were asked](BL-767-queued-question-answers-in-origin-topic.md) —
  extends this feature's `originTopicId` (added here for the TTL receipt) to
  drive the actual queued-question and choice-poll answer routing.
