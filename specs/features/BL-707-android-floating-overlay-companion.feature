Feature: Android floating overlay companion
  A native Android system overlay bubble stays reachable over other apps and
  talks to SwarmForge through the existing Let's Talk / bridge auth path.
  Distinct from Mini App minimize (BL-706). Source: Let's Talk voice 2026-07-29;
  BL-707.

  Background:
    Given the Android floating companion is installed
    And I have granted draw-over-other-apps permission
    And the companion is paired with a valid console control bearer for my bridge

  # BL-707 overlay-01
  Scenario: bubble floats over other apps
    When the floating companion service is running
    Then a movable bubble remains visible while I leave Telegram
    And the bubble is not only the Mini App minimize chrome from BL-706

  # BL-707 overlay-02
  Scenario: bubble expands to a speakable mini panel
    Given the floating bubble is visible
    When I open the bubble into the mini panel
    And I complete a discrete talk or text turn
    Then the turn is submitted on the existing Let's Talk bridge path
    And I get a reply on that same path

  # BL-707 overlay-03
  Scenario: auth stays on the console bearer path
    When a turn is submitted from the floating companion
    Then the request requires the same console control auth as Let's Talk
    And no new public unauthenticated agent surface is opened

  # BL-707 overlay-04
  Scenario: human can dismiss or collapse the overlay
    Given the floating companion is showing bubble or mini panel
    When I collapse or stop the companion
    Then the overlay chrome is removed when I stop
    And collapse returns to the bubble without a stuck invisible overlay

  # BL-707 overlay-04b
  Scenario: drag bubble to bottom remove zone closes it
    Given the floating bubble is visible
    When I drag the bubble onto the bottom remove zone and release
    Then the overlay service stops and the bubble is gone

  # BL-707 overlay-05
  Scenario: hands-free mic survives panel collapse
    Given hands-free is on and the mini panel is listening or mid-turn
    When I collapse to the bubble
    Then the overlay service keeps the voice session alive
    And the bubble can show recording / thinking / speaking state
