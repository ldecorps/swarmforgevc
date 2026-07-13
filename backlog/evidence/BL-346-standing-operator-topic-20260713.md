# BL-346 standing-operator-topic — 20260713 (coder)

## What shipped

One new pure decision function plus one new impure wiring function — the ticket's own framing
("everything else is reuse") held up exactly as described:

- `decideEnsureOperatorTopicAction(topicMap)` (`extension/src/tools/telegramFrontDeskBotCore.ts`) —
  the reserved-subject twin of `topicRouter.ts`'s existing `decideTopicAction`: reuse the topic id
  already bound to the new `OPERATOR_SUBJECT_ID` constant (via the SAME `topicForSubject` lookup
  the reply egress already trusts), or `create` if no binding exists. Two new exported constants:
  `OPERATOR_SUBJECT_ID = 'OPERATOR'` and `OPERATOR_TOPIC_NAME = 'Operator'`.
- `ensureOperatorTopic(targetPath, botToken, chatId, postFn?)` (`extension/src/tools/telegram-front-desk-bot.ts`)
  — calls `createForumTopic` (existing, previously only called from the concierge BL-topic router)
  once if the reserved binding is absent, writes it into the SAME `telegram-topic-map.json` the SUP
  routing already reads. Called once in `main()`, BEFORE the three forever-loops start (`pollLoop`,
  `subscribeReplies`, `tickLoop`) — no inbound message can reach the loop until the binding exists,
  closing the auto-adopt trap the ticket calls out. A failed create logs to stderr and returns; it
  never throws, so the rest of the bot's ordinary SUP-###/BL-### routing is never blocked by it, and
  the next restart retries (the map still lacks the binding).

## The routing math was already correct — verified before writing anything

Before touching any code, traced the full existing routing chain (`decideUpdateAction` →
`TELEGRAM_TOPIC_MESSAGE`/`select-front-desk-dispatch-batch` → `launch-front-desk-operator!` →
`reply-context-for`/`facts-for-wake` → reply write-back → reply-outbox → SSE →
`resolveReplyTopicId`) to find out whether reserving a non-`SUP-\d+`-shaped subject id ("OPERATOR")
would break anything downstream that assumes the `SUP-###` shape:

- `select-front-desk-dispatch-batch` (`telegram_topic_lib.bb`) filters only on event `:type`, never
  on `:subject`'s format — any string dispatches to the restricted Operator.
- `support-lib/next-thread-id`'s auto-increment regex (`"SUP-(\d+)"`) silently ignores a non-numeric
  id, so `"OPERATOR"` can never collide with an auto-assigned `SUP-N`.
- The one open question was whether a subject that never went through `support_thread.bb open`
  (i.e. no thread FILE ever created for it) would break `reply-context-for`'s transcript read or the
  reply write-back. Read `support_thread_store.bb`'s `read-thread!` (returns `nil` for a missing
  file) and the bridge's own `handleTelegramInboundRoute`/`appendMessage` (`extension/src/bridge/supportThreadStore.ts`):
  `appendMessage` ALREADY self-heals a `null` thread into a fresh `{status: 'open', messages: [msg]}`
  on the very first inbound message for any subject id, regardless of how that id was minted. By the
  time the Operator is later dispatched and replies, the thread file already exists (created by the
  inbound message itself), so the reply write-back's own `read-thread!` check succeeds normally.

This meant the reserved subject id needed NO special-casing anywhere in `operator_runtime.bb`,
`telegram_topic_lib.bb`, `support_thread_store.bb`, or the bridge's inbound route — binding it into
the SUP map is the entire net-new surface, exactly as the ticket's own notes predicted. Verified this
holds, not just reasoned about it: `standing-operator-topic-03`'s acceptance scenario drives a real
message through the real bridge for the reserved subject with no thread file pre-created, then a
real `operator_reply.bb` reply, then asserts the reply resolves back through the real
`resolveReplyTopicId` and appears on the real bridge SSE stream — the exact self-healing path, not
mocked.

## Scope boundaries held

- Never touched `launch-front-desk-operator!`, `should-launch-front-desk-operator?`, or anything
  else in `operator_runtime.bb` — the restricted Operator's own boundary (BL-334, `--tools ""`) is
  completely unmodified. No `.bb` file changed in this parcel at all.
- Deleted-topic recovery is explicitly out of scope per the ticket — `decideEnsureOperatorTopicAction`
  only distinguishes "bound" vs "absent from the map"; it has no way to detect a topic that still has
  a map entry but was deleted in Telegram, and none was added.
- No mirroring of `operator.log` activity into the topic — the human's own confirmed "conversation
  only" scope.

## Test coverage

- `extension/test/telegramFrontDeskBotCore.test.js` — `decideEnsureOperatorTopicAction`: creates
  when no reserved binding exists (including on a map with unrelated SUP bindings), reuses the bound
  topic id when present, and is reserved-subject-specific (an ordinary SUP binding never counts).
- `extension/test/telegramFrontDeskBotCli.test.js` — `ensureOperatorTopic` against real fs fixtures
  with a fake `createForumTopic` postFn (mirroring `telegramClient.test.js`'s own seam): creates and
  binds on an empty map, names the topic "Operator", is idempotent against an already-bound map (no
  second create call), recreates with the SAME reserved subject id when absent from an otherwise
  non-empty map, and degrades quietly (no throw, no partial write) on a failed create.
- `specs/pipeline/steps/standingOperatorTopicSteps.js` (new, registered in
  `specs/pipeline/steps/index.js`) — all 7 Gherkin scenarios in
  `BL-346-standing-operator-topic.feature`:
  - 01/07 (creation, including re-creation after being absent from an otherwise non-empty map) drive
    the real `ensureOperatorTopic` against real fixtures.
  - 02/05 (routing, not auto-adopted) drive the real `decideUpdateAction` with a topic already bound,
    asserting `post-existing`/`OPERATOR_SUBJECT_ID`, never `open-for-topic`/`open-default`.
  - 03 (reply lands back in the topic) and 04 (conversation accumulates) drive the real compiled
    bridge (`startBridge`), the real `operator_reply.bb` CLI, and `telegram_reply_context_acceptance_runner.bb`
    (the same tools `telegramTopicThreadsSteps.js` already established for BL-281) against the
    reserved subject id specifically — no thread file pre-seeded, proving the self-healing path.
  - 06 (idempotent restart) calls `ensureOperatorTopic` twice against the same fixture, with the
    second call's fake `postFn` throwing if invoked at all, so a regression would fail loudly rather
    than silently double-creating.

Full regression: `npx vitest run` in `extension/` — 234 test files, 3248 tests, all green. Re-ran the
full existing Telegram/topic acceptance surface this ticket's routing changes touch
(BL-281/BL-294/BL-297/BL-298/BL-300/BL-325 feature files) — all green, confirming
`decideUpdateAction`'s unchanged behavior for every existing SUP-###/BL-### path.

## What was explicitly not done

No real Telegram API call anywhere in any test (every `createForumTopic` call is given a fake
`postFn`, matching this project's own "never send/create for real from an automated test"
convention). No `.bb` file touched. No E2E run against the real live production forum — the ticket's
own "E2E QA PROCEDURE" section explicitly reserves that as QA's manual final check (delete the
recorded topic id, restart the real front desk, confirm exactly one real "Operator" topic exists),
since a fixture that fakes the Telegram side "proves nothing about the auto-adopt trap" by the
ticket's own words.
