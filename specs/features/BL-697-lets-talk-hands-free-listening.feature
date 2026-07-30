Feature: Let's Talk hands-free listening

  # Operator-requested 2026-07-27. Extends BL-696 — same server turn model;
  # only the WebView capture loop changes when the toggle is on.
  #
  # HOST: extension/src/bridge/letsTalkUiHtml.ts (client-only).
  # Pure thresholds: extension/src/bridge/letsTalkCore.ts

  Background:
    Given the SwarmForge bridge Mini App is reachable with my allowlisted console token
    And I am on the Let's Talk screen

  # BL-697 lets-talk-hands-free-01
  Scenario: the Let's Talk screen exposes a hands-free toggle
    Then the page shows a hands-free control
    And hands-free is off by default on first visit

  # BL-697 lets-talk-hands-free-02
  Scenario: enabling hands-free while ready starts listening without tapping Record
    When I enable hands-free
    Then the record control shows a listening state
    And the microphone capture has started

  # BL-697 lets-talk-hands-free-03
  Scenario: hands-free submits a turn after the user stops speaking
    Given hands-free is enabled
    And I have started a hands-free capture
    When I speak a short question and then stay silent for the silence threshold
    Then the turn is submitted to the bridge
    And conversation state becomes "thinking" then "speaking" then "ready"

  # BL-697 lets-talk-hands-free-04
  Scenario: after agent playback hands-free re-opens the microphone
    Given hands-free is enabled
    And I completed one hands-free turn
    When the agent reply finishes playing
    Then the record control shows a listening state again
    And I did not tap Record

  # BL-697 lets-talk-hands-free-05
  Scenario: disabling hands-free stops auto-listening
    Given hands-free is enabled and listening
    When I disable hands-free
    Then auto-listening is cancelled
    And the record control returns to the manual Record label

  # BL-697 lets-talk-hands-free-06
  Scenario: manual Record still works when hands-free is off
    Given hands-free is off
    When I tap Record, speak, and tap Stop
    Then the turn is submitted exactly as in BL-696
