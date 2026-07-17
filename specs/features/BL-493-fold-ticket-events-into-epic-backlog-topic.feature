Feature: Fold a ticket's swarm events into its epic or the Backlog topic as an edit-in-place status message

  Background:
    Given the standing Backlog topic exists
    And a ticket's epic membership is read from its epic field

  # BL-493 fold-ticket-events-01
  Scenario: An epic-bound ticket event posts a status message into its epic's topic, prefixed with the ticket id
    Given a ticket whose epic field names an epic
    And no status message has been recorded for that ticket yet
    When a swarm event for the ticket is routed
    Then a status message is posted into that epic's topic
    And the status message is prefixed with the ticket id and its current lifecycle state
    And the recorded status message identity for the ticket is remembered

  # BL-493 fold-ticket-events-02
  Scenario: An epic-less ticket event posts a status message into the standing Backlog topic, prefixed with the ticket id
    Given a ticket whose epic field is empty
    And no status message has been recorded for that ticket yet
    When a swarm event for the ticket is routed
    Then a status message is posted into the standing Backlog topic
    And the status message is prefixed with the ticket id and its current lifecycle state
    And the recorded status message identity for the ticket is remembered

  # BL-493 fold-ticket-events-03
  Scenario: A later lifecycle transition edits the same ticket's status message in place
    Given a status message has already been recorded for a ticket
    When a later lifecycle transition for the ticket is routed
    Then the previously recorded status message is edited in place
    And its status prefix reflects the ticket's new lifecycle state
    And no additional status message is posted for the ticket

  # BL-493 fold-ticket-events-04
  Scenario: No per-ticket topic is created for any ticket event
    Given a ticket whose event would formerly have created a per-ticket topic
    When a swarm event for the ticket is routed
    Then no per-ticket topic is created

  # BL-493 fold-ticket-events-05
  Scenario: An ApprovalRequested surfaces awaiting-approval via the Approvals topic only
    Given a ticket transitions to awaiting approval
    When the ApprovalRequested event is routed
    Then the awaiting-approval ask renders in the standing Approvals topic
    And no throwaway per-ticket topic is minted to carry an awaiting-approval icon
