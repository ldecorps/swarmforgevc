Feature: Operator hands an actionable thread to the coordinator and tracks the ticket back

  Background:
    Given the Operator can hand an actionable subject thread to the coordinator

  # BL-283 coordinator-handoff-01
  Scenario: an actionable thread files an intake to the coordinator and links the ticket
    Given a subject thread that has become actionable
    When the Operator hands it off
    Then it files an intake to the coordinator referencing the subject
    And the thread records the linked ticket

  # BL-283 coordinator-handoff-02
  Scenario: the handoff proposes work without creating or promoting the ticket
    Given a subject thread that has become actionable
    When the Operator hands it off
    Then it does not create, spec, or promote the ticket itself

  # BL-283 coordinator-handoff-03
  Scenario: a change in the linked ticket's status is reported into the subject's topic
    Given a thread linked to a ticket whose status has moved on
    When the Operator checks the linked ticket
    Then it posts the new status into that subject's topic

  # BL-283 coordinator-handoff-04
  Scenario: an unchanged linked ticket produces no status notice
    Given a thread linked to a ticket that is still at the same status
    When the Operator checks the linked ticket
    Then it posts no status notice

  # BL-283 coordinator-handoff-05
  Scenario: a status notice goes only to the linked subject's topic
    Given two subjects and a ticket linked to only the first
    When the Operator checks the linked ticket
    Then only the first subject's topic receives the status
