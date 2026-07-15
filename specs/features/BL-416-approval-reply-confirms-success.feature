Feature: a ticket-topic reply never falsely claims "nothing to approve"

  # The front desk sends one static "Nothing to approve right now" for ANY reply
  # in a ticket's topic that isn't an exact approve keyword — ignoring THIS
  # topic's own pending state. Wrong twice: after a successful approve (BL-412),
  # and for an unrelated question on a still-pending ticket (BL-414). The
  # pending check must be per-topic, and the fallback must not be factually false.

  Background:
    Given a human reply arrives in a ticket's Telegram topic

  # BL-416 approval-reply-confirms-success-01
  Scenario: approving a genuinely-pending ticket confirms the approval by name
    Given this topic's ticket is pending approval
    And the reply is the approve keyword
    When the reply is processed
    Then the ticket's approval field is set to approved
    And the confirmation names the approved ticket as a success
    And the confirmation is not the generic "nothing to approve" text

  # BL-416 approval-reply-confirms-success-02
  Scenario: a non-keyword reply on a still-pending ticket is not told there is nothing to approve
    Given this topic's ticket is still pending approval
    And the reply is not an approve, reject, or amend keyword
    When the reply is processed
    Then the response reflects that this ticket is still awaiting approval
    And the response is not the generic "nothing to approve" text

  # BL-416 approval-reply-confirms-success-03
  Scenario: the pending determination is scoped to this topic's own ticket
    Given this topic's ticket is pending approval while a different ticket is not
    When a reply is processed in this topic
    Then the pending state considered is this topic's ticket, not a global slot

  # BL-416 approval-reply-confirms-success-04
  Scenario: a reply in a topic whose ticket is genuinely not pending may say nothing to approve
    Given this topic's ticket is not pending approval
    When a non-keyword reply is processed
    Then the generic "nothing to approve" response is acceptable
