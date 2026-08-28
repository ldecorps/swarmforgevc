Feature: An entangled tip at the land step has a remedy the swarm can actually reach
  Roles work on one long-lived branch and hold several tickets at once, so a
  commit approved for ticket A routinely has sibling tickets' unlanded work as
  ancestors. That is normal pipelining, not misconduct - and it means the
  question "would landing this put unreviewed work on main?" can be YES for a
  parcel whose own author did nothing wrong.

  Bouncing such a parcel back to its author cannot resolve it: no role can
  remove commits that are ancestors of its own branch. On 2026-08-28 three
  parcels were bounced this way in one pass and none of them had a move
  available.

  The land step needs an outcome that changes the situation.

  Background:
    Given a parcel approved for its own ticket at the land step

  # BL-1241 entangled-tip-remedy-01
  Scenario: A tip carrying only its own ticket's unlanded work lands
    Given no other ticket's unlanded work is an ancestor of the commit
    When the land step runs
    Then the commit is landed

  # BL-1241 entangled-tip-remedy-02
  Scenario: A tip carrying a sibling's unlanded work is not landed silently
    Given another ticket's unlanded work is an ancestor of the commit
    When the land step runs
    Then the commit is not landed
    And the outcome names every sibling ticket whose work is entangled

  # BL-1241 entangled-tip-remedy-03
  Scenario: The outcome is addressed to whoever can act on it
    Given another ticket's unlanded work is an ancestor of the commit
    When the land step runs
    Then the outcome is not a bounce to the parcel's own author
    And the outcome names an action that removes the entanglement

  # BL-1241 entangled-tip-remedy-04
  Scenario: An approved verdict survives the entanglement
    Given the parcel has passed every quality gate for its own ticket
    And another ticket's unlanded work is an ancestor of the commit
    When the land step runs
    Then the parcel's own approval is still recorded
    And the parcel is not required to repeat the stages it already passed
