# BL-620 architect pass — 2026-08-19

Reviewed: coder's `bdab5ce61` ("front desk reads photo captions and logs
every dropped update"), merged straight through by cleaner in `d58777ed5`
(no cleaner-authored changes — the merge diff is empty of anything beyond
the coder's own commit plus routine backlog-topic bookkeeping unrelated to
this ticket).

## Scope
`messageTextOf` now falls back to `update.message?.caption` — one seam
every text-reading consumer inherits. `checkUpdateEligibility` gets a
distinct `media-no-caption` reason (absent/empty caption on a photo).
`annotateRoutedMediaText` appends a "not read by the front desk" note at
the three `processMessageUpdate` posting boundaries (post-existing,
operator-context, open-decision). `processMessageUpdate`'s drop branch
logs exactly one bounded line through the new optional
`PollAdapters.logDropAudit`, wired in production to the same stderr stream
`telegram-front-desk-bot.ts` already uses for other operational notices.

## Dependency-rule gate (BL-259, hard gate)
`node extension/out/tools/dependency-gate.js src/tools/telegram-front-desk-bot.ts
src/tools/telegramFrontDeskBotCore.ts src/tools/telegramTopicDecisions.ts`
(paths relative to `extension/`, its cwd) reports the same 3 pre-existing
`telegram-front-desk-bot.ts -> telegramCursorOperatorExec.ts` /
`telegramCursorOperatorLiveness.ts` acyclic violations seen on every recent
pass. This parcel's own diff to `telegram-front-desk-bot.ts` (5 lines,
adding `logDropAudit` to `buildPollAdapters`) adds no new import — confirmed
by reading the diff, not assumed. Already tracked as BL-759, unrelated to
this ticket.

## Co-change report (informational)
`telegramFrontDeskBotCore.ts`'s top co-changes are its own natural partners
(`telegram-front-desk-bot.ts`, its own test file, `specs/pipeline/steps/index.js`)
— all already touched by this parcel. Nothing unexpected. The pre-existing
`telegramFrontDeskBotCore.property.test.js` is a shared multi-invariant file
(BL-483 and others) — the coder's choice to add a new, separate
`frontDeskDropAudit.property.test.js` for this ticket's own invariant
matches the project's established one-file-per-invariant-ticket convention
(bl628/bl654/bl689 all do the same), not a missed consolidation.

## Invariant (the one declared)
"Every dropped inbound update logs exactly one line naming the drop reason
— no drop path, current or future, is silent."

Encoded as `frontDeskDropAudit.property.test.js`, driving the REAL
`pollAndForward` over 200 generated batches mixing every eligibility shape
(principal/stranger, own/foreign chat, text/textless/photo-caption/
photo-none/photo-empty). Asserted: audit lines are exactly one per dropped
update, in id order, each equal to `formatDropAuditLine(id, reason)`,
single-line, and a posted update never logs one.

**Non-vacuity — verified myself, not taken on the commit message.** This
file has no dedicated `test('non-vacuity: ...')` block, unlike every other
`.property.test.js` in this repo I checked (`bl628...`, `bl654...`,
`bl689...`, `bl717...` all carry one as a permanent regression guard) — it
only carries a code comment claiming the break was checked by hand. Per my
own Invariants Review duty ("you never hand-verify a property whose own
test does not exist or does not bite"), I reproduced the break myself:
removed the `adapters.logDropAudit?.(...)` call in
`telegramFrontDeskBotCore.ts`, recompiled, ran the property — it failed
immediately (`Counterexample: [[{"kind":"text",...}]]`, `0 !== 1`, shrunk to
a single dropped update with no audit line). Restored the line, recompiled,
reran — green again; `git diff` on the source file is empty. The property
is genuinely non-vacuous. Flagged below for hardener as a missing permanent
regression-guard test, not a defect in the property itself.

## Correctness spot-checks
- `media-no-caption` classification: `update.message?.photo ? 'media-no-caption'
  : 'no-text'` — a voice note carries no `photo` and is pre-empted to its own
  path earlier (BL-426), so it can never misclassify; confirmed by reading
  both call orderings, matches the regression row in the unit suite.
- `annotateRoutedMediaText` is applied at the three `processMessageUpdate`
  posting boundaries but never inside `decideUpdateAction` itself — the pure
  decision for a caption is required to equal the decision for the
  identical plain text (scenario 01 asserts deep equality), which it does;
  annotation is correctly a posting-time concern, not a decision-time one.

## Gap flagged as a note to specifier + coordinator (Article 4.4, not a bounce)
The ticket's own description states the "no vision" annotation as a general
principle for "routed content," but the actual acceptance criteria scope it
narrowly: scenario 04 only covers the backlog-topic routing path
(post-existing/open-for-topic). The other four surfaces scenario 02 confirms
now inherit CAPTION TEXT via the shared seam — steering (`processSteeringUpdate`
-> `redirectToRole`), agent-questions (`attemptAgentQuestionsTopicDelivery`
-> `postToBridge`), control-delivery, and the negotiation relay — post that
text onward with NO annotation, and I traced the same gap further into the
reserved-subject reply paths (`deliverApprovalsTopicReply`'s rejection
`reason`, `deliverRecertTopicReply`'s amend `newText`), which can now also
carry caption-derived text unannotated. The coder implemented exactly what
the Gherkin scenarios specify (13/13), so this is not a defect against
written acceptance criteria — it is the description's stated intent
outrunning the scenario coverage. Sending a `note` (priority 00) to
specifier and coordinator in this same pass rather than bouncing; BL-620
itself is not blocked on it.

## Property testing (BL-654, architect's own pass)
No additional undeclared-property gap found on the touched pure modules
beyond the ticket's own declared invariant, which the coder already
encoded and I independently verified above.

## Unit/acceptance runs (reproduced live, not taken on the commit message)
- `npx vitest run test/telegramFrontDeskBotCore.test.js`: 388/388 passed.
- `npx vitest run --config vitest.properties.config.mjs frontDeskDropAudit`:
  1/1 passed (plus the deliberate-break/restore cycle above).
- `./specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-620-front-desk-caption-messages-and-drop-audit.feature`:
  13/13 scenarios passed.

## Verdict
COMPLIANT. Forwarding to hardender. Flagging for hardener: add a permanent
`test('non-vacuity: ...')` block to `frontDeskDropAudit.property.test.js`
matching this repo's own convention (I proved it live above, but that
verification doesn't persist as a regression guard). Separately, a `note`
to specifier + coordinator on the routed-media-annotation scope question
above.
