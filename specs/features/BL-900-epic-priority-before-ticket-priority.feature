Feature: Promotion ranking considers the containing epic's priority before the ticket's own

  The coordinator ranks eligible promotion candidates. Ordering compares the
  priority of the epic a candidate belongs to before the candidate's own
  priority number, so raising an epic no longer means rewriting every child.
  Lower priority numbers sort first. The Article 3.2.4 expedite bucket stays
  ahead of everything.

  Background:
    Given a backlog whose eligible candidates are ranked for promotion

  # BL-900 epic-priority-before-ticket-priority-01
  Scenario Outline: the epic's priority is compared before the ticket's own
    Given a candidate "BL-A" whose epic tracker priority is <epic_a> and whose own priority is <own_a>
    And a candidate "BL-B" whose epic tracker priority is <epic_b> and whose own priority is <own_b>
    When the candidates are ranked
    Then "<first>" is ranked first

    Examples:
      | epic_a | own_a | epic_b | own_b | first |
      | 5      | 90    | 40     | 1     | BL-A  |
      | 40     | 1     | 5      | 90    | BL-B  |
      | 40     | 1     | 40     | 90    | BL-A  |
      | 40     | 50    | 40     | 50    | BL-A  |

  # BL-900 epic-priority-before-ticket-priority-02
  Scenario: an expedited defect still outranks a candidate from a more urgent epic
    Given a candidate "BL-D" of type "defect" with severity "high" whose epic tracker priority is 900
    And a candidate "BL-E" whose epic tracker priority is 1 and whose own priority is 1
    When the candidates are ranked
    Then "BL-D" is ranked first

  # BL-900 epic-priority-before-ticket-priority-03
  Scenario: a candidate whose epic has no tracker keeps its own priority
    Given a candidate "BL-F" whose epic has no tracker and whose own priority is 20
    And a candidate "BL-G" whose epic tracker priority is 50 and whose own priority is 90
    When the candidates are ranked
    Then "BL-F" is ranked first

  # BL-900 epic-priority-before-ticket-priority-04
  Scenario: an epic with several trackers ranks by its most urgent tracker
    Given an epic "swarm-intelligence-layer" with tracker priorities 30, 31 and 35
    And a candidate "BL-H" in epic "swarm-intelligence-layer" whose own priority is 90
    And a candidate "BL-I" whose epic tracker priority is 33 and whose own priority is 1
    When the candidates are ranked
    Then "BL-H" is ranked first

  # BL-900 epic-priority-before-ticket-priority-05
  Scenario: the ranking is a deterministic total order
    Given candidates whose epic priorities are variously absent, duplicated and unparseable
    When the candidates are ranked twice, the second time from a shuffled enumeration
    Then both rankings are identical

  # BL-900 epic-priority-before-ticket-priority-06
  Scenario: epic priority never grants an extra active slot
    Given the active backlog is already at its configured maximum depth
    And a candidate from the most urgent epic is eligible
    When the coordinator runs promotion
    Then no candidate is promoted
