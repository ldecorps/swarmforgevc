Feature: A ticket never states a lifecycle position its folder contradicts

  The folder a ticket file sits in is what the pipeline moves and what every
  consumer reads. The yaml status field is written once at mint and then left
  alone, so most closed tickets still assert they are open. A hand sweep in
  July fixed 64 of them and the count grew back to 516, because the sweep
  changed the corpus and nothing else.

  These scenarios describe the outcome, not the mechanism. Compliance is
  whatever the approved direction makes it: the field brought into agreement
  with the folder, or the folder-shadowing values retired so only a recorded
  design state remains. Either way a reader must not be able to find a closed
  ticket claiming to be open, and no closing route may put one back.

  Background:
    Given a repository whose backlog is compliant with the folder-agreement gate

  # BL-1059 folder-agreement-gate-01
  Scenario Outline: A closed ticket claiming to be open is reported
    Given a ticket in "<folder>" whose yaml claims the ticket is still open
    When the folder-agreement gate runs over the backlog
    Then the gate fails
    And it names that ticket and the folder it sits in

    Examples:
      | folder                      |
      | backlog/done                |
      | backlog/done/M8             |

  # BL-1059 folder-agreement-gate-02
  Scenario: A compliant backlog is reported clean
    When the folder-agreement gate runs over the backlog
    Then the gate passes
    And it reports no contradictions

  # BL-1059 folder-agreement-gate-03
  Scenario Outline: A recorded decision is never treated as a contradiction
    Given a ticket in "<folder>" whose yaml records the design state "<state>"
    When the folder-agreement gate runs over the backlog
    Then the gate passes
    And the ticket's design state is left unchanged

    Examples:
      | folder         | state        |
      | backlog/paused | needs_design |
      | backlog/paused | blocked      |
      | backlog/done   | superseded   |

  # BL-1059 folder-agreement-gate-04
  Scenario Outline: Closing a ticket by any route leaves the backlog compliant
    Given an open ticket in "backlog/active"
    When it is closed into the done folder by "<route>"
    Then the gate passes

    Examples:
      | route                    |
      | the panel mark-done verb |
      | the done-with-current    |
      | a hand git mv            |

  # BL-1059 folder-agreement-gate-05
  Scenario Outline: An answer naming a closed ticket is still refused
    Given an answer file at the backlog root naming a ticket in "<folder>"
    When the answer drain runs
    Then the answer is reported as arrived late
    And it is not executed

    Examples:
      | folder          |
      | backlog/done    |
      | backlog/done/M8 |
