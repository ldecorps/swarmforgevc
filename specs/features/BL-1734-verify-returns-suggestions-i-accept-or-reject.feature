Feature: BL-1734 Verify returns suggestions I accept or reject one by one

  The form's Verify button reviews the draft before it is submitted, and
  returns each finding as a suggestion with its own Accept and Reject,
  plus Accept all. Nothing reaches the draft without a tap. This slice
  runs the checks the host can make on its own: IR-DRY over the draft's
  steps (the vendored APS checker), near-duplicates between the draft's
  narrative values and the shared vocabulary, and tickets in the backlog
  that already deliver the draft's action. BL-1735 adds the specifier
  session's own review to the same list.

  Background:
    Given a draft is open in the form

  # BL-1734 a-repeated-step-comes-back-as-a-suggestion-01
  Scenario: Verify lists each finding on its own
    Given the draft's two scenarios repeat the same Given step
    When I press Verify
    Then each suggestion is listed on its own with Accept and Reject
    And one suggestion names the repeated step

  # BL-1734 a-rejected-suggestion-changes-nothing-02
  Scenario: a rejected suggestion leaves my draft as it was
    Given Verify suggested replacing the actor "operator" with the existing "the operator"
    When I reject that suggestion
    Then my draft's actor is "operator"

  # BL-1734 an-accepted-suggestion-is-applied-03
  Scenario: an accepted suggestion is applied to my draft
    Given Verify suggested replacing the actor "operator" with the existing "the operator"
    When I accept that suggestion
    Then my draft's actor is "the operator"

  # BL-1734 accept-all-applies-every-open-suggestion-04
  Scenario: Accept all applies every open suggestion
    Given Verify returned three suggestions
    When I press Accept all
    Then my draft carries all three changes

  # BL-1734 verify-names-an-existing-ticket-05
  Scenario: Verify names a ticket that already delivers my draft's action
    Given the backlog holds a ticket that already delivers my draft's action
    When I press Verify
    Then a suggestion names that ticket
