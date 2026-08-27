Feature: The real backlog-depth cap enforcement respects whichever pack/config actually launched the swarm

  # BL-313 depth-cap-override-01
  Scenario: a pack's declared cap is the one actually enforced
    Given the swarm was launched with a pack declaring active_backlog_max_depth 1
    And the backlog has more active items than that pack's declared cap
    When the depth WARNING and AUTO-PROMOTE gates evaluate
    Then they enforce the pack's declared cap, not the default config's

  # BL-313 depth-cap-override-02
  Scenario: a bare launch with no override still enforces the default config's own cap
    Given the swarm was launched with no pack or config override
    When the depth WARNING and AUTO-PROMOTE gates evaluate
    Then they enforce the default swarmforge.conf's own declared cap

  # BL-313 depth-cap-override-03
  Scenario: the launch banner states the effective cap and its source
    Given the swarm has just launched
    When the launch banner is shown
    Then it states the effective active_backlog_max_depth and which config file supplied it

  # BL-313 depth-cap-override-04
  Scenario: no pack's declared cap value is changed by this fix
    Given each pack's own conf file declared a cap before this fix
    When this fix is applied
    Then each pack's conf file still declares the same cap value as before
