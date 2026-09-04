Feature: BL-1380 Expedite never answers a question the operator was not shown

  Tapping Expedite on the paused pager records the operator's approval before
  the promotion gates run, so that Expedite satisfies the approval gate rather
  than being blocked by it. When the ticket declares ruling options, that bare
  approval also answers a question nobody was asked: the ask stops being
  pending and the choice is gone. This feature is that Expedite still satisfies
  the approval gate, and still refuses out loud rather than silently, but never
  records a ruling the operator never gave.

  Background:
    Given a paused ticket "BL-9004" awaiting approval

  # BL-1380 a-choice-is-never-answered-by-a-tap-01
  Scenario: expediting a ticket that posed a choice never records a bare approval
    Given "BL-9004" declares ruling options and has no ruling on record
    When the operator expedites "BL-9004" from the pager
    Then "BL-9004" is not recorded as approved without a ruling
    And the ruling options of "BL-9004" are still awaiting an answer

  # BL-1380 the-refusal-names-the-gate-and-the-options-02
  Scenario: the refusal says which gate refused and what the choices are
    Given "BL-9004" declares ruling options and has no ruling on record
    When the operator expedites "BL-9004" from the pager
    Then the response names the gate that refused
    And the response carries the option labels of "BL-9004"
    And the response is not a bare status code

  # BL-1380 a-refusal-changes-nothing-03
  Scenario: a refused expedite leaves the ticket exactly where it was
    Given "BL-9004" declares ruling options and has no ruling on record
    When the operator expedites "BL-9004" from the pager
    Then "BL-9004" is still in backlog/paused/
    And the file of "BL-9004" is byte-unchanged
    And no promotion was attempted for "BL-9004"

  # BL-1380 a-plain-ticket-expedites-as-before-04
  Scenario Outline: a ticket with nothing to choose expedites exactly as it does today
    Given "BL-9004" declares no ruling options and <state>
    When the operator expedites "BL-9004" from the pager
    Then "BL-9004" is promoted to backlog/active/
    And the priority of "BL-9004" is 0

    Examples:
      | state                          |
      | is awaiting approval           |
      | was never pending approval     |

  # BL-1380 an-answered-choice-expedites-and-is-preserved-05
  Scenario: a ticket whose choice is already answered expedites and keeps its answer
    Given "BL-9004" declares ruling options and already has a ruling on record
    When the operator expedites "BL-9004" from the pager
    Then "BL-9004" is promoted to backlog/active/
    And the ruling on record for "BL-9004" is unchanged
