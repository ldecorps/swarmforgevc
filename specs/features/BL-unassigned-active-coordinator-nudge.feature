Feature: Unassigned active tickets nudge the coordinator

  An item in backlog/active/ with no assigned_to must not sit forever at
  board NS while the coordinator idles on mailbox NO_TASK. The daemon
  nudges the coordinator to assign_to + route; it never writes assigned_to
  itself (intake/routing remains the coordinator's exclusive duty).

  Background:
    Given an item in backlog/active/ with no assigned_to
    And the sweep runs at the existing chase interval

  # unassigned-active-nudge-01
  Scenario: an unassigned active item with no handoff trail nudges the coordinator
    Given no handoff trail mentions the item
    When the sweep runs
    Then the coordinator receives a note asking it to assign_to and route the item
    And no assigned_to is written on the ticket by the sweep

  # unassigned-active-nudge-02
  Scenario: an already-nudged unassigned item is not re-nudged
    Given a prior coordinator note already trails the item
    When the sweep runs
    Then the sweep sends no further nudge for the item
