Feature: Bubble takes its capability flags and hold-music catalog from the bridge

  Capability flags and hold-music tunes are served as versioned documents so a
  bridge redeploy changes the phone. A missing or unusable document leaves
  Bubble on its bundled defaults rather than degraded.

  Background:
    Given a running bridge and a paired Bubble install

  # BL-765 remote-config-01
  Scenario: Capability flags are served as a versioned document
    When the bubble config endpoint is requested
    Then the response carries a schema version and a revision
    And it names every capability Bubble can enable or disable

  # BL-765 remote-config-02
  Scenario Outline: An unusable config document leaves the bundled defaults in place
    Given the served bubble config is <state>
    When Bubble applies remote configuration
    Then every bundled default capability stays enabled
    And the effective revision reports the bundled default

    Examples:
      | state             |
      | absent            |
      | not valid JSON    |
      | missing features  |

  # BL-765 remote-config-03
  Scenario: Disabling a capability remotely removes it without a new APK
    Given the served bubble config disables the hold music capability
    When Bubble applies remote configuration
    Then hold music is not offered
    And the remaining capabilities stay enabled

  # BL-765 chiptunes-04
  Scenario: The hold-music catalog is served as data
    When the chiptunes catalog endpoint is requested
    Then the response carries a catalog version and a list of songs
    And each song carries a name, a tempo, and its step data

  # BL-765 chiptunes-05
  Scenario: A song added to the catalog reaches the phone on redeploy
    Given a song is added to the served catalog
    When Bubble refreshes its hold-music list
    Then the added song is selectable
    And no application package was rebuilt

  # BL-765 volume-06
  Scenario: Music volume no longer governs the reply voice
    Given the music volume setting is lowered
    When a reply is spoken while hold music plays
    Then the hold music plays at the configured level
    And the reply voice plays at full gain
