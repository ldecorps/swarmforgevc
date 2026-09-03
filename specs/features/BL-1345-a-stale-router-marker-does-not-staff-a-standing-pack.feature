# mutation-stamp: sha256=81d96eaad15078dc632c492aa17b44b090ab9fe7e0110a8563658e365842e38d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T02:36:03.829517208Z","feature_name":"BL-1345 a mis-staffed pane is detected, and the resident marker is not read where it does not apply","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1345-a-stale-router-marker-does-not-staff-a-standing-pack.feature","background_hash":"2644daf382c84862a0b66c9cb2469f86aa14b0a552423ad4fd85066e98141526","implementation_hash":"unknown","scenarios":[{"index":4,"name":"An unusable marker changes nothing the sweep concludes","scenario_hash":"bdb1a833dcf220b242f77755aa2009287d4073ea21aa751529e850669a9d47ca","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-03T02:36:03.829517208Z"}]}
# acceptance-mutation-manifest-end

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
