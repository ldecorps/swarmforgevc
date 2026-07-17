Feature: The approval Amend button prompts the human for a steer, marks the ticket as amending, and queues that steer for delivery to the specifier

  # BL-509 (human-requested — ldecorps 2026-07-17, direct: "when asked to approve a ticket, the amend
  # button should enable me to steer the ticket"). EPIC — this feature file covers SLICE 1 only (the bot +
  # schema surface); slices 2 (daemon routes the steer to the specifier) and 3 (specifier revises and
  # re-presents) are parked in BL-509-amend-button-steers-ticket.slices-2-3-wiring-loop.feature.draft and
  # MUST land for the loop to deliver value — slice 1 ALONE leaves a ticket in the new 'amending' state
  # with nothing acting on it. Do not declare the epic done after slice 1.
  #
  # TODAY (verified 2026-07-17): tapping Amend silently stashes a pending-button marker and sends the human
  # NO prompt; the next free-text reply is captured, written to .swarmforge/operator/events.jsonl as a
  # TELEGRAM_BL_TOPIC_MESSAGE and to the ticket's backlog/topics/<id>.json record, and the ticket's
  # human_approval is LEFT 'pending' (the ask is never closed). The one live consumer of that event
  # (operator_runtime.bb -> operator-decide.js approve) treats the text as an APPROVAL ANSWER and echoes a
  # reply back into the same topic — it never reaches the specifier. So Amend does not actually steer the
  # ticket. Human's three decisions (2026-07-17): (a) the steer routes to the specifier who revises and
  # re-presents [slices 2/3]; (b) tapping Amend PROMPTS for the steer text; (c) the ticket shows a distinct
  # 'amending' state while it is being revised.
  #
  # SLICE 1 CONTRACT (this file):
  #   1. Tapping Amend replies in-topic asking the human what to change, and waits for the reply (no longer
  #      a silent stash). The approval verdict is unchanged until the human actually replies.
  #   2. The human's reply marks the ticket human_approval: amending (a NEW value — see schema note), and
  #      CLOSES the approval ask (like Approve/Reject do), so the ticket leaves the Approvals topic while it
  #      is being revised. Because 'amending' is a not-pending value, a later flip back to 'pending'
  #      (slice 3) re-fires the ApprovalRequested ask on the not-pending -> pending transition (schema
  #      BL-357) — slice 1 must therefore RESET the approval-ask emitted-state for this ticket when it
  #      writes 'amending', so the re-ask is not suppressed as already-emitted (the emittedKeys/repaint
  #      concern, BL-496).
  #   3. The reply is recorded on the ticket's backlog/topics/<id>.json record (audit trail, as today) AND
  #      queued as a DISTINCT amend-steer directive keyed by the backlog id and carrying the human's text —
  #      distinguishable from a plain approval-answer event so slice 2's daemon route can pick it up and
  #      send it to the specifier rather than the current operator-decide 'approve' path consuming it.
  #
  # SCHEMA: add 'amending' to the human_approval enum in swarmforge/backlog-schema.md (currently
  # 'pending' | 'approved', plus 'rejected'): set by the amend flow, cleared back to 'pending' by the
  # specifier on re-present (slice 3). LITERAL VALUE ONLY, never a folded block (the pending-detector rule).
  # Land the doc change in this parcel with the code (BL-233).
  #
  # SCOPE (grep-confirm the live path at build):
  #   - extension/src/tools/telegramFrontDeskBotCore.ts: the Amend tap (decideCallbackQueryAction /
  #     dispatchRecognizedCallbackDecision) now sends a prompt on tap; the amend reply branch in
  #     deliverOperatorContext writes the 'amending' verdict + closes the ask + emits the distinct
  #     amend-steer directive (today the amend branch does none of these).
  #   - extension/src/concierge/pendingApprovalReply.ts: add recordAmendReply writing human_approval:
  #     amending in place (mirror recordApprovalReply/recordRejectionReply; find ticket by id across
  #     active+paused live folders).
  #   - extension/src/tools/telegram-front-desk-bot.ts / operatorEventQueue.ts: emit the amend-steer
  #     directive (a new event type or a kind:'amend' marker on the topic event) so slice 2 can route it.
  #   - swarmforge/backlog-schema.md: document the 'amending' value.
  #   - specs/pipeline/steps/bl409*/bl410* + extension/test/telegramFrontDeskBotCore.test.js: the existing
  #     tests pin the OLD amend contract ("records the note WITHOUT changing approval state", no prompt) —
  #     revise them to the new prompt + amending-verdict contract IN THIS PARCEL (BL-233; specifier owns the
  #     feature wording, coder owns the step handlers/unit tests). See ticket notes for the exact sites.
  #
  # E2E QA PROCEDURE: on the real Telegram Approvals/ticket topic, tap Amend on a pending ticket and confirm
  # the bot asks what to change; reply with a steer and confirm the ticket's human_approval flips to
  # 'amending' in its backlog YAML, the approval card is closed, and the steer is recorded on the topic
  # record and queued as an amend directive (inspect events.jsonl for the distinct amend marker). Verify
  # against the real surface, not only a fixture (BL-335). Slices 2/3 verify the onward route + revise loop.

  Background:
    Given a ticket is awaiting approval in its Telegram topic

  # BL-509 amend-steers-ticket-01
  Scenario: Tapping Amend prompts the human for the steer and does not yet change the verdict
    When the human taps Amend on the ticket
    Then the bot asks the human what to change on the ticket
    And the ticket's approval state is still pending

  # BL-509 amend-steers-ticket-02
  Scenario: Replying with a steer marks the ticket as amending and closes the approval ask
    Given the human has tapped Amend on the ticket
    When the human replies with steering text
    Then the ticket's human_approval becomes "amending"
    And the approval ask for the ticket is closed
    And the steering text is recorded on the ticket's topic record

  # BL-509 amend-steers-ticket-03
  Scenario: A steer reply is queued as a specifier-bound directive, not an approval answer
    Given the human has tapped Amend on the ticket
    When the human replies with steering text
    Then an amend-steer directive carrying the ticket id and the steering text is queued
    And the directive is distinguishable from a plain approval-answer event
