Feature: Reorder epic priority from the Mini App console

  Reordering an epic today means hand-editing `priority:` in its
  backlog/paused/BL-*.yaml and committing by hand. This puts that action on the
  live holistic UI (the token-authed Mini App console), never on the static
  backlog-dashboard PWA — that surface is a read-only git-SHA projection with
  no bridge connectivity and no write path.

  Reordering is expressed as SWAP, not renumber: moving an epic up exchanges
  its priority value with its neighbour's, so exactly two files change and
  every untouched epic keeps the value it already had. Repeated moves compose
  into any order without ever renumbering the list.

  Background:
    Given the epic reorder screen is open on the live Mini App console
    And the epics are listed by priority, lowest value first

  # BL-572 epic-reorder-01
  Scenario: moving an epic up swaps its priority with the epic above it
    Given the selected epic has priority 20
    And the epic above it has priority 10
    When the human moves the selected epic up
    Then the selected epic is written with priority 10
    And the epic above it is written with priority 20
    And no other epic's backlog YAML is modified

  # BL-572 epic-reorder-02
  Scenario: adjacent epics sharing one priority value still reorder
    Given the selected epic has priority 20
    And the epic above it has priority 20
    When the human moves the selected epic up
    Then the selected epic ends with a lower priority value than the epic above it
    And no other epic's backlog YAML is modified

  # BL-572 epic-reorder-03
  Scenario: moving the highest-priority epic up changes nothing
    Given the selected epic is first in the list
    When the human moves the selected epic up
    Then no backlog YAML is modified

  # BL-572 epic-reorder-04
  Scenario: the screen lists epic trackers only
    Given a paused ticket of type "epic" exists
    And a paused ticket of type "feature" exists
    When the epic reorder screen loads
    Then only the ticket of type "epic" is listed

  # BL-572 epic-reorder-05
  Scenario: a reorder without control auth is refused
    Given a reorder request carrying no valid control token
    When the request reaches the bridge
    Then the bridge refuses the reorder
    And no backlog YAML is modified

  # BL-572 epic-reorder-06
  Scenario: a completed reorder is committed to main
    When the human moves the selected epic up
    Then both changed backlog YAML files are committed to main
