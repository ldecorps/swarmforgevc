# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-17T10:11:48Z) - a DEFECT the human hit live, not a desk call.
RAW ask, not a spec: the specifier drains it and decides whether to REOPEN BL-484
or file a follow-up fix ticket.

## The question

BL-484 shipped but its repaint does NOT work on real asks. The human approved
BL-491 in the live Approvals topic and the message kept its Approve/Amend/Reject
buttons with no verdict line - the exact behaviour BL-484 was meant to fix.

### Operator-verified evidence (facts, not a spec)

- The decision DID register (BL-491 no longer pending; Approvals pinned message
  reads "No tickets are currently awaiting approval"). So recordApprovalReply
  fired.
- The message id IS persisted: .swarmforge/operator/telegram-approval-ask-
  messages.json has {"BL-491":{"topicId":1785,"messageId":2234,...}}. So the
  BL-484 message_id-persistence half works.
- The closing routine IS wired and invoked: telegramFrontDeskBotCore.js
  recordApprovalDecisionAndClose -> closeApprovalAskIfPossible; and its three
  adapters (recordApprovalReply / readApprovalAskMessage / editApprovalAskMessage)
  are all siblings in the SAME adapter bundle (telegram-front-desk-bot.js
  ~lines 1082-1088). So it is NOT the "not wired" branch.
- THE FAILURE: editApprovalAskMessage -> editMessageText(botToken, chatId,
  messageId, text, undefined, undefined, null) returns success:false at runtime.
  closeApprovalAskIfPossible logs `front-desk bot: failed to close the approval
  ask for BL-491 (message edit failed or not wired)` and no-ops. This log line is
  present in .swarmforge/operator/front-desk-supervisor.log. So the real Telegram
  editMessageText call is being REJECTED.

### Root cause + why QA missed it (for the specifier/architect/QA)

- The Telegram edit is failing against the LIVE API while acceptance passed - the
  classic fixture-only-acceptance gap (cf BL-454): the adapter was almost
  certainly stubbed to return true in the Gherkin/unit path, so the real
  editMessageText response shape was never exercised. QA must run the REAL
  decision->edit round-trip against a live/faithful Telegram, not a stub.
- DIAGNOSABILITY DEFECT compounding it: editApprovalAskMessage throws away the
  error - `.then((r) => r.success)` - and closeApprovalAskIfPossible logs a
  generic message without r.error. The failed edit's actual Telegram rejection
  reason (chat/thread targeting? empty inline_keyboard reply_markup? parse/entity?
  message-too-long? not-modified?) is INVISIBLE. The fix's FIRST step must surface
  r.error so the real rejection is knowable; right now it cannot be diagnosed from
  logs.
- Note for the fixer: the roster edit-in-place (plainTextEditInPlaceAdapters)
  uses the SAME editMessageText+chatId and WORKS; the ask-close call differs only
  by passing buttons=null (reply_markup {inline_keyboard: []}) as the 7th arg.
  That is the prime suspect to check first, but confirm against the real r.error
  rather than assuming.

### Blast radius

- Every decided approval ask stays open with live, re-tappable buttons - the
  stale-tap hazard BL-484 was meant to close.
- BLOCKS the pending "Expedite button" intake, which is designed to reuse this
  same closing routine - it inherits the broken edit.

### Disposition is the specifier's

Reopen BL-484 (QA bounce - shipped-but-broken) or file a scoped fix ticket. Not
mine to decide; not a spec.

## UPDATE (operator, after the human approved a BATCH)

CRITICAL REFINEMENT: the repaint is INTERMITTENT, not a blanket failure. In one
batch the human approved BL-491..495; some repainted instantly, some did not.
Per-ask outcome from the message store + supervisor log:
  - REPAINTED ok: BL-492 (len 955), BL-495 (len 819)
  - EDIT FAILED : BL-491 (len 907), BL-493 (len 1079), BL-494 (len 954)
Length is NOT the differentiator: BL-492 (955, ok) vs BL-494 (954, failed) are
one char apart. All same topic (1785), consecutive message ids, plain text.

LEADING HYPOTHESIS: Telegram per-chat rate-limiting (HTTP 429) on the burst of
editMessageText calls. The intermittent, batch-correlated pattern fits this
strongly, AND the code makes it unrecoverable: editApprovalAskMessage does
`editMessageText(...).then((r) => r.success)` - it DISCARDS r.retryAfterSeconds
(which callTelegramApi already extracts, telegramClient.js ~line 85) and NEVER
RETRIES. So any edit that hits a 429 is silently dropped. The bot ALSO edits the
roster + pipeline-board messages in-place every tick, so approval-ask edits
compete with those for the same per-chat edit budget even outside a human burst
(explains BL-491 failing earlier as an apparent single approval).

FIX must therefore, in priority order:
  1. Surface r.error (stop discarding it) so the real rejection is provable - do
     NOT ship a fix on this hypothesis without first confirming the 429 in a log.
  2. Honour retryAfterSeconds with a bounded retry/backoff on the ask-close edit
     (the retry data is already extracted, just unused here).
  3. Real-path acceptance that approves MULTIPLE asks in a burst against a
     rate-limit-simulating Telegram double, not a stub that returns true.

NOTE: an operator attempt to capture the live 429 by replaying the edit with the
bot's own token was (correctly) gated by the host as an outward-facing action
using production creds - so #1 (in-code error logging) is the right place to get
the truth, not an out-of-band operator poke.
