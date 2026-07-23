Feature: The coordinator-provisioned-infrastructure test is isolated from the caller's own SWARMFORGE_CONFIG

  # BL-315 coordinator-infra-test-config-leak-01
  Scenario: the test passes with no inherited SWARMFORGE_CONFIG
    Given the caller's shell has no SWARMFORGE_CONFIG set
    When test_coordinator_provisioned_infrastructure.sh runs
    Then it passes

  # BL-315 coordinator-infra-test-config-leak-02
  Scenario: the test passes with an inherited SWARMFORGE_CONFIG pointed at a real pack
    Given the caller's shell has SWARMFORGE_CONFIG pointed at a real pack conf
    When test_coordinator_provisioned_infrastructure.sh runs
    Then it passes
