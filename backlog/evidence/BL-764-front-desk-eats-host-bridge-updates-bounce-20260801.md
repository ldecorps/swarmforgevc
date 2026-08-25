# BL-764 architect bounce — 20260801

Commit reviewed: `b44f62ca51` (cleaner tip; coder `7c0cd3a17` + cleaner
`b44f62ca5`), on top of `d62135aee` (post BL-716 merge-up).

Full review inventory below — every check this pass owns is RUN or explicitly
BLOCKED, per Article 4.4. Nothing here is a first-failure stop; all findings are
reported together in this one bounce.

## Checks run

- Dependency-gate hard gate (`node extension/out/tools/dependency-gate.js`,
  changed files + full-repo scan): 3 `acyclic` violations reported
  (`telegram-front-desk-bot.ts` <-> `telegramCursorOperatorExec.ts` /
  `telegramCursorOperatorLiveness.ts`). Verified via `git log -S` + `git
  merge-base --is-ancestor` that both edges predate this parcel's base commit
  (`e54d2129a`, `f9b38f53d`, both ancestors of `d62135aee`) — pre-existing
  baseline debt, already ticketed as BL-759 (`backlog/paused/`), and already
  ruled out of scope for a different parcel by a prior architect pass (see
  BL-759 `source:`). **Not attributed to this parcel — PASS.**
- Co-change report (`node extension/out/tools/co-change-report.js`, changed
  files): no new/unexpected coupling flagged beyond the ticket's own known
  file set. **PASS.**
- `required_wiring` (4 items): all four confirmed live-wired (not dark
  modules) — `forwardCursorBridgeUpdate` reached from
  `attemptCursorBridgeTopicExclusion`; `drainCursorBridgeInboundUpdates`
  reached from `runCursorBridgePollOnce`'s `useInboundQueue` branch;
  `shouldUseCursorBridgeInboundQueue` reached from `runCursorBridgeApp`;
  `CURSOR_BRIDGE_INBOUND_QUEUE` exported by `start_cursor_bridge.sh`. **PASS.**
- Full test run of every changed test file (`telegramCursorBridgeCore`,
  `telegramCursorBridgeLive`, `telegramCursorBridgeCli`,
  `telegramCursorBridgeLiveness`, `telegramCursorBridgeRedeploy`,
  `telegramFrontDeskBotCore`, `cursorBridgeInboundQueue` +
  `.property.test.js`): 572 unit tests green, property test green
  (`npm run test:properties` config). **PASS.**
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-764-front-desk-eats-host-bridge-updates.feature`: 7/7
  scenarios green. **PASS.**
- Architecture boundaries (two-layer view/substrate, extension-host-owns-I/O,
  no webview storage, secrets never in target-repo commits): N/A/clean — this
  parcel touches no webview code; the new `.swarmforge/operator/cursor-bridge-
  inbound.jsonl` file follows the same gitignored-state-file precedent as the
  existing `cursor-bridge-state.json`, no secret written. **PASS.**
- Invariants Review (ticket declares 3 invariants) — see findings D1-D3 below.
- Property-testing pass (undeclared properties on touched pure modules): the
  touched modules are otherwise adapter/wiring code (Telegram I/O, adapters),
  not additional property-shaped pure logic beyond what the declared
  invariants already cover. No additional property test owed here.

## Findings

### D1 — invariant #1 has neither a property test nor a stated non-encodability reason
- class: invariant-unencoded
- blamed role: coder
- Declared: "At most one process calls Telegram getUpdates for a given bot
  token; any second consumer of that token reads its updates from the on-disk
  fan-out instead."
- The parcel encodes the DECISION function
  (`shouldUseCursorBridgeInboundQueue`) with example tests only
  (`telegramCursorBridgeCore.test.js`) — no `*.property.test.js` exists for
  it, and no comment/commit message states why example coverage is judged
  sufficient (e.g. because the literal cross-process claim isn't fast-check-
  encodable and the decision table is the practical proxy). Per BL-654
  (`backlog/done/BL-654-declared-invariant-requires-coder-property-test.yaml`,
  invariants[2]): "absence of both is always a send-back."
- Remediation: either add a small property test over the env-var decision
  space (`CURSOR_BRIDGE_INBOUND_QUEUE` ∈ {unset,'0','1',other},
  `CURSOR_BRIDGE_BOT_TOKEN` set/unset) in
  `extension/test/telegramCursorBridgeCore.property.test.js`, or record
  explicitly in the commit/code why the cross-process claim is judged
  non-encodable and the decision-table example tests are the intended proxy.

### D2 — invariant #2 has neither a property test nor a stated non-encodability reason
- class: invariant-unencoded
- blamed role: coder
- Declared: "An inbound update addressed to a bridge-owned topic is either
  forwarded to that bridge or explicitly dropped with a recorded reason —
  never routed to SUP/Operator, and never silently discarded."
- Only invariant #3 (redelivery idempotence) got a `.property.test.js`
  (`cursorBridgeInboundQueue.property.test.js`, well-designed, non-vacuous).
  Invariants #1 and #2 got "more example scenarios" per the ticket's own
  `notes:`, but that line is specifier framing written before the coder's
  work, not a coder-stated reason recorded in the parcel — and BL-654 draws
  the line at "the parcel carries ... a parcel-recorded reason", not ticket
  text written in advance of the implementation.
- This one is a stronger property-test candidate than #1: forward-outcome
  coverage (topic ownership × update kind [message/callback_query/
  poll_answer] × forward adapter success/failure) is a decision space a
  property test would naturally sweep, and BL-590/BL-606 are the standing
  precedent for what an unswept decision space costs later.
- Remediation: same two options as D1 — property test over the decision
  space, or a stated reason.

### D3 — the new callback_query bridge-topic exclusion has zero test coverage
- class: invariant-unencoded
- blamed role: coder
- `processUpdate`'s new early check (`telegramFrontDeskBotCore.ts`,
  `if (update.callback_query) { const cursorBridgeOutcome = await
  attemptCursorBridgeTopicExclusion(...); ... }`) is the fix for exactly the
  invariant-#2 gap that mattered most: before this diff, a callback_query
  (button press) landing in a Cursor Remote/Bubble topic went straight to
  `processCallbackQuery` — i.e. could be routed to SUP/Operator, the one
  thing invariant #2 forbids outright.
- Grepped the full test suite for `decideCursorBridgeExclusion` and
  `attemptCursorBridgeTopicExclusion` by name and for any `callback_query`
  fixture carrying a bridge-owned `topicId`: no hit. All new coverage
  (`telegramFrontDeskBotCore.test.js`, 4 new tests) exercises plain
  `message` updates and one `poll_answer` update — none exercise
  `callback_query`. The fallback extraction added in
  `decideCursorBridgeExclusion` (`topicIdOf(update) ??
  update.callback_query?.message?.message_thread_id`) is itself unexercised
  by any test.
- This is the same failure shape Article 4.4/BL-333 exists to catch: a real,
  currently-unverified branch in the exact path the ticket's own invariant
  #2 was written to close.
- Remediation: add at least one test driving `pollAndForward`/`processUpdate`
  with a `callback_query` update whose `message.message_thread_id` is a
  bridge-owned topic id, asserting it is forwarded (or dropped-with-reason)
  and never reaches `processCallbackQuery`'s SUP/Operator paths (mirror the
  existing message-update forward/drop/poll_answer tests already present).

## Blocked checks
None — every check this pass owns was run to completion (dependency gate,
co-change, required_wiring, full test run, acceptance, invariants review).

## Not bounced (recorded separately, out of this ticket's declared scope)
The busy-queue "choose next queued question" poll
(`postQueueSelectionPoll`/`processQueuedPollAnswer` in
`telegramCursorBridgeLive.ts`) is a pre-existing, Cursor-Remote-only
mechanism not touched by this diff's `required_wiring` or invariants. Now
that Bubble is a full forwarding peer, a Bubble-originated message queued
while the bridge is busy gets its ack in Bubble but its eventual
selection-poll and answer only in Cursor Remote. Not a violation of a
declared invariant or acceptance scenario for BL-764 — flagged to
specifier/coordinator by `note` as a likely BL-765 follow-up, not bounced.
