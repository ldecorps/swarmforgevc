Feature: BL-1345 a mis-staffed pane is detected, and the resident marker is not read where it does not apply

  Hotfix 195de28861 stopped `swarm ensure`'s RC repair respawning a
  stale-marker role into another role's pane, by routing rc-launch-role
  through the one shared BL-1020 decision. Two things it did not do remain,
  and both are about NOTICING rather than causing:

  the health sweep still reads `.swarmforge/mono-router-active-role` without
  asking which pack is running, so on a standing pack it reasons about a
  resident that does not exist; and after a pane HAS been respawned with
  another role's script, the post-repair recheck still reported it healthy.

  Background:
    Given a standing pack is running, with every role in its own pane

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-01
  Scenario: The health sweep does not treat a leftover marker as the resident
    Given a leftover resident marker naming a role
    When the health sweep gathers its facts
    Then it reports no resident role for this pack

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-02
  Scenario: The sweep still resolves the resident on a rotation-router pack
    Given a rotation-router pack is running
    And a resident marker naming a known role
    When the health sweep gathers its facts
    Then it reports that role as the resident

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-03
  Scenario: A pane running the wrong role is never reported healthy
    Given a pane running a role other than the one its pack assigns it
    When the health of that pane is rechecked
    Then it is not reported healthy
    And the report names the pane, the expected role and the observed one

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-04
  Scenario: A correctly staffed pane is still reported healthy
    Given a pane running the role its pack assigns it
    When the health of that pane is rechecked
    Then it is reported healthy

  # BL-1345 a-stale-router-marker-does-not-staff-a-standing-pack-05
  Scenario Outline: An unusable marker changes nothing the sweep concludes
    Given a resident marker that is "<state>"
    When the health sweep gathers its facts
    Then it reports no resident role for this pack

    Examples:
      | state                  |
      | absent                 |
      | unreadable             |
      | naming an unknown role |
