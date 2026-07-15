Feature: a successful Telegram approval reply confirms success, not "nothing to approve"

  # A human replied "Approved" in a ticket's topic; the field flipped to approved
  # correctly, but the bot answered "Nothing to approve right now" — because the
  # confirmation re-derived pending state AFTER the write, when it correctly read
  # "no longer pending". The success must be captured from the PRE-write state.

  Background:
    Given a ticket topic with a pending approval and a human reply of "approve"

  # BL-416 approval-reply-confirms-success-01
  Scenario: approving a pending ticket confirms the approval by name
    When the approval reply is processed
    Then the ticket's approval field is set to approved
    And the confirmation names the approved ticket as a success
    And the confirmation is not the generic "nothing to approve" text

  # BL-416 approval-reply-confirms-success-02
  Scenario: the confirmation is decided from the pre-write pending state
    Given the reply satisfied an approval that was pending before the write
    When the confirmation is composed
    Then it is composed from the fact that a pending approval was just satisfied
    And it does not re-read the post-write approval state to decide the message

  # BL-416 approval-reply-confirms-success-03
  Scenario: an approve reply with nothing actually pending still says nothing to approve
    Given a ticket topic with no pending approval
    When a human reply of "approve" is processed
    Then the confirmation is the generic "nothing to approve" text
