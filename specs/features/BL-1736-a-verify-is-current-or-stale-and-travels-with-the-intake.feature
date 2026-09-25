Feature: BL-1736 A Verify is current or marked stale, and travels with the intake

  A Verify reviews the draft as it was when it ran. Once the draft
  changes, its suggestions may no longer apply, so the form says so. One
  Verify runs per draft at a time. The submitted intake carries every
  suggestion and what the human did with it, so the specifier who drains
  the queue does not repeat that review.

  Background:
    Given a draft is open in the form

  # BL-1736 an-edit-makes-the-last-verify-stale-01
  Scenario: editing after a Verify marks it stale
    Given the draft was verified
    When I edit a scenario
    Then the Verify result is marked stale

  # BL-1736 one-verify-at-a-time-02
  Scenario: a second Verify while one is running does not start another
    Given a Verify of the draft is still running
    When I press Verify again
    Then no second Verify starts
    And the form says a Verify is already running

  # BL-1736 the-verify-history-travels-with-the-intake-03
  Scenario: the submitted intake carries each suggestion and its outcome
    Given Verify returned two suggestions and I accepted one and rejected the other
    When I submit the draft
    Then the INTAKE file lists both suggestions
    And it records the first as accepted and the second as rejected
