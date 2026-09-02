Feature: BL-1343 the replay never drops the landing ticket's own path in silence

  The land step replays a ticket onto origin/main from its own changed paths:
  the full origin/main..tip diff, minus the paths positively attributed to an
  unlanded sibling and to no other id. Attribution is what decides that
  subtraction, and it can answer "sibling" for a path the landing ticket's own
  tip introduced. When it does, the path leaves the replay set, the replay has
  nothing to commit, and the ticket's work stays off main while everything
  upstream of the land step reads as approved and complete.

  These scenarios pin the one thing the current shape does not guarantee: the
  landing ticket's own content either lands or the land refuses out loud. It
  is never silently subtracted.

  Background:
    Given a ticket approved at a tip whose content is not yet on origin/main

  # BL-1343 replay-drops-the-tickets-own-path-01
  Scenario: A path only the landing ticket introduced is replayed
    Given a path present at the tip and absent from origin/main
    And no sibling commit in the walked range touches it
    When the land step computes the ticket's own paths
    Then that path is in the replay set

  # BL-1343 replay-drops-the-tickets-own-path-02
  Scenario: A path attributed to nobody is still replayed
    Given a path present at the tip and absent from origin/main
    And no commit in the walked range is attributed to any ticket for it
    When the land step computes the ticket's own paths
    Then that path is in the replay set

  # BL-1343 replay-drops-the-tickets-own-path-03
  Scenario: A path the ticket introduced is never subtracted in silence
    Given a path present at the tip and absent from origin/main
    And the only commits the attribution walk sees touching it name an unlanded sibling
    When the land step computes the ticket's own paths
    Then the land step refuses
    And the refusal names that path, the landing ticket and the sibling

  # BL-1343 replay-drops-the-tickets-own-path-04
  Scenario: An empty replay set is a refusal whenever the tip still differs
    Given the replay set for the landing ticket is empty
    And the tip still differs from origin/main on at least one path
    When the land step decides
    Then the land step refuses
    And it does not report the ticket as landed

  # BL-1343 replay-drops-the-tickets-own-path-05
  Scenario: An empty replay set on an identical tip is a real answer
    Given the replay set for the landing ticket is empty
    And the tip is identical to origin/main
    When the land step decides
    Then the land step reports nothing left to replay
    And it does not refuse

  # BL-1343 replay-drops-the-tickets-own-path-06
  Scenario: Unreadable attribution still refuses rather than narrowing
    Given one path's attribution cannot be read
    When the land step computes the ticket's own paths
    Then the land step refuses and names what it could not read
