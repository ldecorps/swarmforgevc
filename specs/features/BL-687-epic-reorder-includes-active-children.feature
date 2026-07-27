Feature: Within-epic reorder covers every live child, in flight included

  Background:
    Given epic ticket "BL-545" declares epic slug "swarm-intelligence-layer" with priority 35
    And epic ticket "BL-517" declares epic slug "swarmforge-console" with priority 6
    And paused topic "BL-624" declares epic slug "swarm-intelligence-layer" with priority 20
    And active topic "BL-590" declares epic slug "swarm-intelligence-layer" with priority 30
    And hold topic "BL-548" declares epic slug "swarm-intelligence-layer" with priority 40
    And done topic "BL-672" declares epic slug "swarm-intelligence-layer" with priority 1
    And done topic "BL-660" declares epic slug "swarmforge-console" with priority 2

  # BL-687 epic-reorder-includes-active-children-01
  Scenario: The drill-down lists an epic's paused, hold and active children, never its done ones
    When the "BL-545" tile is drilled into
    Then the drill-down lists exactly "BL-624,BL-590,BL-548"

  # BL-687 epic-reorder-includes-active-children-02
  Scenario Outline: Each drill-down row says whether that child is in flight
    When the "BL-545" tile is drilled into
    Then row "<topic>" is marked in flight "<inFlight>"

    Examples:
      | topic  | inFlight |
      | BL-590 | yes      |
      | BL-624 | no       |
      | BL-548 | no       |

  # BL-687 epic-reorder-includes-active-children-03
  Scenario: Making a parked child top ranks it above its in-flight sibling
    When the make-top button on row "BL-548" is tapped in the "BL-545" drill-down
    Then the topic make-top route answers success
    And the drill-down lists exactly "BL-548,BL-624,BL-590"

  # BL-687 epic-reorder-includes-active-children-04
  Scenario: An in-flight child is itself reorderable and its own file is rewritten
    When the make-top button on row "BL-590" is tapped in the "BL-545" drill-down
    Then the topic make-top route answers success
    And the drill-down lists exactly "BL-590,BL-624,BL-548"
    And the rewritten priority for "BL-590" is committed in "backlog/active/"

  # BL-687 epic-reorder-includes-active-children-05
  Scenario: A depends_on pointing at an in-flight ticket neither bounds nor refuses the move
    Given hold topic "BL-548" depends on "BL-590"
    When the make-top button on row "BL-548" is tapped in the "BL-545" drill-down
    Then the topic make-top route answers success
    And the drill-down lists exactly "BL-548,BL-624,BL-590"
    And row "BL-548" shows no live-dependency marker

  # BL-687 epic-reorder-includes-active-children-06
  Scenario: An epic whose only child is done drills down to the reorderable-topics empty state
    When the "BL-517" tile is drilled into
    Then the drill-down shows "No reorderable topics under this epic."

  # BL-687 epic-reorder-includes-active-children-07
  Scenario: The epic-tile Make top verb still ignores in-flight tickets
    When the make-top button on the "BL-545" tile is tapped
    Then live topic "BL-590" keeps its priority
