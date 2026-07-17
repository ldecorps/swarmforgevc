Feature: Telegram inline-keyboard buttons offer a one-tap alternative to typed approval replies

  Background:
    Given a pending-review ticket with an ApprovalRequested message posted in its topic

  # BL-410 approval-inline-keyboard-01
  Scenario: an ApprovalRequested message carries Approve, Amend, and Reject buttons
    Given the ApprovalRequested message has just been posted
    When its Telegram payload is inspected
    Then it includes an inline keyboard with Approve, Amend, and Reject buttons

  # BL-410 approval-inline-keyboard-02
  Scenario: tapping Approve flips the ticket the same way a typed approve reply does
    Given a callback_query for the Approve button on that message
    When the bot processes the callback
    Then the ticket's backlog file human_approval line becomes approved

  # BL-410 approval-inline-keyboard-03
  Scenario: tapping Reject records a reason the same way a typed reject reply does
    Given a callback_query for the Reject button followed by a reason reply
    When the bot processes the callback and the reason
    Then the ticket's backlog file human_approval line becomes rejected with that reason

  # BL-410 approval-inline-keyboard-04
  Scenario: tapping Amend prompts for a note and records it without changing approval state
    Given a callback_query for the Amend button followed by a note reply
    When the bot processes the callback and the note
    Then the note is posted as operator context on the ticket
    And the ticket's human_approval value is unchanged

  # BL-410 approval-inline-keyboard-05
  Scenario: typed replies still work unchanged alongside the buttons
    Given a topic reply of "approve" sent instead of tapping a button
    When the reply is recorded against the ticket
    Then the ticket's backlog file human_approval line becomes approved

  # BL-410 approval-inline-keyboard-06
  Scenario: every button tap clears its Telegram loading spinner
    Given any callback_query received for one of the three buttons
    When the bot processes it
    Then it sends an answerCallbackQuery response for that callback
