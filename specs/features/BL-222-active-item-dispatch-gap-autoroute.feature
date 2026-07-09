Feature: The sweep auto-routes never-dispatched active backlog items

  Background:
    Given an item in backlog/active/ assigned to a role
    And the sweep runs at the existing chase interval

  # BL-222 dispatch-gap-01
  Scenario: an active item with no routing handoff to its assignee is auto-routed
    Given the assignee's mailbox holds no routing handoff for the item
    When the sweep runs
    Then the assignee receives a routing handoff for the item

  # BL-222 dispatch-gap-02
  Scenario Outline: an item that already has or has had a dispatch is not re-routed
    Given the item <dispatch_state>
    When the sweep runs
    Then the sweep sends no further routing handoff for the item

    Examples:
      | dispatch_state                                  |
      | already has a routing handoff for the assignee  |
      | has already progressed to a later pipeline role |
