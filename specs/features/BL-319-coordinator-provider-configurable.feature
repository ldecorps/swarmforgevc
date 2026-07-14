Feature: Coordinator provider is configurable like all other roles

# BL-319: Coordinator provider is configurable like all other roles

Background:
  Given the swarm is configured with a specific provider for the coordinator
  And the coordinator is provisioned as reserved infrastructure

# BL-319 coordinator-provider-configurable-01
Scenario: Coordinator launches with configured provider (copilot)
  Given the pack config specifies coordinator_agent as copilot
  When the swarm launches
  Then the coordinator should be launched using the copilot provider
  And the coordinator's launch script should not contain Claude-specific flags

# BL-319 coordinator-provider-configurable-02
Scenario: Default coordinator provider is claude when not configured
  Given no coordinator_agent config is present
  When the swarm launches
  Then the coordinator should default to claude provider
  And should use the same flags as today's launch

# BL-319 coordinator-provider-configurable-03
Scenario: Unknown coordinator provider fails launch loudly
  Given a pack file contains config coordinator_agent with an unknown provider name bogus
  When the swarm attempts to launch
  Then the launch should fail with an explicit error about unknown provider

# BL-319 coordinator-provider-configurable-04
Scenario: Coordinator handoff injection works with non-Claude provider
  Given the coordinator is running with copilot provider
  When a handoff needs to be delivered to the coordinator
  Then the handoff should be successfully injected into the copilot agent's session
