Feature: Reorder epics lists only epics that have live children

  A paused epic tracker with no live child is a shell. It must not occupy a
  tile, and it must not occupy a Move up / Move down neighbour slot, so a tap
  always lands where it looks like it will. Hiding is a view concern only.

  Background:
    Given a backlog containing paused epic trackers
    And epic membership is resolved by slug

  # BL-905 hide-childless-epics-reorder-01
  Scenario: An epic with no live children is not listed
    Given an epic tracker with no children in any folder
    When the reorder state is requested
    Then that epic is not listed
    And that epic's file is unchanged on disk

  # BL-905 hide-childless-epics-reorder-02
  Scenario Outline: A single live child in any live folder is enough
    Given an epic tracker whose only child is in <folder>
    When the reorder state is requested
    Then that epic is <visibility>

    Examples:
      | folder | visibility |
      | paused | listed     |
      | hold   | listed     |
      | active | listed     |
      | done   | not listed |

  # BL-905 hide-childless-epics-reorder-03
  Scenario: An epic tracker is not a child of itself
    Given an epic tracker whose only slug match is another epic tracker
    When the reorder state is requested
    Then that epic is not listed

  # BL-905 hide-childless-epics-reorder-04
  Scenario: A hidden epic cannot swallow a move
    Given a childless epic tracker positioned between two epics with children
    When the lower epic with children is moved up
    Then it exchanges places with the upper epic with children
    And the childless epic tracker keeps its position on disk

  # BL-905 hide-childless-epics-reorder-05
  Scenario: The listing and the move neighbours never disagree
    Given a backlog mixing epics with and without live children
    When the reorder state is requested
    And an epic is moved
    Then the move resolves against exactly the epics that were listed

  # BL-905 hide-childless-epics-reorder-06
  Scenario: Make-top still dominates hidden epics
    Given a childless epic tracker and an epic with children
    When the epic with children is made top
    Then its priority dominates the childless epic tracker
