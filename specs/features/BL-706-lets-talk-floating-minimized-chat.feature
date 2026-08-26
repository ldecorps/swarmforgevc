Feature: Let's Talk minimizes into a floating talk chat
  The full Let's Talk page can collapse into a floating chat-like surface
  that stays visible and speakable, then expand back. Same discrete turn
  loop as today. Source: Let's Talk voice ask 2026-07-29; BL-706.

  Background:
    Given the SwarmForge bridge Mini App is reachable with my allowlisted console token
    And I am on the Let's Talk screen

  # BL-706 float-01
  Scenario: the full page can be minimized
    When I choose minimize on the Let's Talk page
    Then the full-page layout is collapsed
    And a floating talk surface remains visible on screen

  # BL-706 float-02
  Scenario: the floating surface stays speakable
    Given Let's Talk is minimized to the floating talk surface
    When I complete a talk turn from that floating surface
    Then the turn is submitted on the existing Let's Talk path
    And I hear the reply playback as usual

  # BL-706 float-03
  Scenario: the full page can be restored
    Given Let's Talk is minimized to the floating talk surface
    When I choose expand or restore from that surface
    Then the full Let's Talk page layout is shown again

  # BL-706 float-04
  Scenario: minimized mode is not a hidden background-only state
    When Let's Talk is minimized
    Then the floating talk surface remains visible enough to talk to
    And the session is not only buried with no on-screen talk chrome
