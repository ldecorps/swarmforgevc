Feature: Expedite an approval ask: approve, force-promote, and dispatch a ticket to build now

  Background:
    Given an approval ask was posted in a ticket's Telegram topic
    And the posted ask is the BL-410 inline-keyboard approval ask

  # BL-490 expedite-approval-01
  Scenario: The approval ask offers Expedite alongside Approve, Amend, and Reject
    When the approval ask's buttons are rendered for a ticket
    Then the rendered buttons include an Expedite button
    And the Expedite button carries the expedite verb tagged with the ticket id
    And the Approve, Amend, and Reject buttons are still present

  # BL-490 expedite-approval-02
  Scenario: Tapping Expedite records approval through the same effect as a plain Approve
    Given the ticket is still pending review
    When the Expedite button is tapped for the ticket
    Then the ticket's human_approval is recorded as approved
    And the approval is recorded through the same effect path a plain Approve tap uses

  # BL-490 expedite-approval-03
  Scenario: Expediting a paused ticket force-promotes it into the active set
    Given the ticket is in the paused backlog
    When the Expedite button is tapped for the ticket
    Then the ticket is moved into the active backlog
    And the promotion happens without waiting for the coordinator's sequencing

  # BL-490 expedite-approval-04
  Scenario: Expediting dispatches the ticket to build immediately, bypassing sequencing triage
    Given the ticket has been approved and promoted by an expedite tap
    When the expedite effect completes
    Then a routing handoff is injected to start the build immediately
    And the dispatch bypasses the coordinator's orthogonality and sequencing triage

  # BL-490 expedite-approval-05
  Scenario: An already-active ticket is expedited without a redundant promotion
    Given the ticket is already in the active backlog
    When the Expedite button is tapped for the ticket
    Then the ticket is approved and dispatched to build immediately
    And no paused-to-active promotion is attempted

  # BL-490 expedite-approval-06
  Scenario: A forced dispatch that collides with an in-flight same-file build warns the human
    Given a build is already in flight that edits the same files as the ticket
    When the Expedite button is tapped for the ticket
    Then the human is shown a clear toast that the forced dispatch is unsafe
    And the ticket is still approved and queued to build without preempting the in-flight build

  # BL-490 expedite-approval-07
  Scenario: An expedited ask closes itself like any other decided ask
    Given the ticket is still pending review
    When the Expedite button is tapped for the ticket
    Then the posted ask's inline keyboard is removed
    And an Expedited decision line with the recorded UTC time is appended to the message

  # BL-490 expedite-approval-08
  Scenario: A tap on an already-decided ask performs no expedite side effect
    Given a decision has already been recorded for the ticket
    When the Expedite button on the already-decided ask is tapped
    Then the callback is answered with an already-decided toast
    And no approval, promotion, or dispatch side effect is performed
