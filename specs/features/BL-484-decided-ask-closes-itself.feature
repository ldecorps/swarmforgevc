Feature: A decided approval ask closes itself in its Telegram topic

  Background:
    Given an approval ask was posted in the ticket's topic with its message_id persisted
    And the posted ask shows an inline keyboard of Approve, Amend, and Reject buttons

  # BL-484 decided-ask-closes-01
  Scenario: Recording an approval strips the ask's buttons and appends the verdict to the message
    Given the ticket is still pending review
    When the Approve button on the ask is tapped
    Then the closing routine edits the persisted ask message to remove its inline keyboard
    And the edited message keeps the original ask text above the appended decision line
    And the appended decision line records the Approved verdict and the recorded UTC decision time

  # BL-484 decided-ask-closes-02
  Scenario: A typed-reply decision closes the posted ask the same way a button tap does
    Given the ticket is still pending review
    When a typed reply of "reject BL-484 bad scope" is recorded against the ticket
    Then the closing routine edits the persisted ask message to remove its inline keyboard
    And the edited message keeps the original ask text above the appended decision line
    And the appended decision line records the Rejected verdict and the reason "bad scope"

  # BL-484 decided-ask-closes-03
  Scenario: A tap on an already-decided ask yields an informative callback answer and no side effect
    Given a decision of approved has already been recorded for the ticket
    When a button on the already-decided ask is tapped
    Then the callback is answered with an already-decided toast naming the approved verdict
    And no decision side effect is performed for that tap

  # BL-484 decided-ask-closes-04
  Scenario: A failed message edit is logged and does not break the decision recording
    Given the persisted ask message can no longer be edited because it was deleted from the topic
    When an approval is recorded for the ticket
    Then the failed message edit is logged
    And the ticket's human_approval decision is still recorded as approved
    And the decision tick completes without crashing
