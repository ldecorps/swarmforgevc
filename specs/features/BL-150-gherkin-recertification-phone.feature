Feature: Human recertification of Gherkin scenarios via the phone PWA

  Background:
    Given living .feature files exist (BL-111) with tracked scenarios
    And each scenario has a "last reviewed" timestamp in a separate durable store

  # BL-150 recert-01 oldest-first-selection
  Scenario: the human is shown the least-recently-reviewed scenario first
    Given multiple scenarios have different last-reviewed timestamps
    When the human opens the recertification view in the phone app
    Then the scenario with the oldest last-reviewed timestamp is surfaced first

  # BL-150 recert-02 confirm
  Scenario: confirming a scenario updates its timestamp and requeues it at the back
    Given a scenario is presented for recertification
    When the human confirms it unchanged
    Then the scenario's last-reviewed timestamp is updated to now
    And the scenario moves to the back of the review queue

  # BL-150 recert-03 update
  Scenario: updating a scenario sends a proposed edit for specifier review
    Given a scenario is presented for recertification
    When the human edits its text and submits the update
    Then an email is sent via the inbound-email write path with the scenario id, outcome "update", and the new text
    And the extension host queues it as a review proposal rather than applying it directly
    And the scenario's last-reviewed timestamp is updated to now once the outcome is recorded

  # BL-150 recert-04 delete-requires-confirmation
  Scenario: deleting a scenario requires an explicit in-app confirmation before it is even sent
    Given a scenario is presented for recertification
    When the human chooses to delete it
    Then the phone app requires an explicit confirmation step
    And only after that confirmation is an email sent via the inbound-email write path with outcome "delete"

  # BL-150 recert-05 delete-proposal-then-removal
  Scenario: a confirmed delete is queued as a proposal and removes the scenario from the review queue once accepted
    Given the human has confirmed a delete in-app and the delete email has been sent
    When the extension host receives the inbound email
    Then it queues the delete as a review proposal for the specifier
    And once the specifier accepts it, the scenario is removed from the recertification queue

# Non-behavioral notes:
#  - Write-path emails are asserted through the inbound-webhook seam with
#    test doubles; no live email send in tests.
#  - The proposal queue reuses the existing rule_proposal-style durable
#    review mechanism; specifier review/accept/reject is out of this
#    ticket's testable scope beyond the queuing contract above.
