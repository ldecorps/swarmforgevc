Feature: the fleet is a composite of swarms (consolidated console)

  # Baton fleet epic (BL-242) child. Two swarms, two projects, one console. The
  # console subscribes to each swarm's coordinator and treats a fleet of one
  # identically to a fleet of many. PoC transport = POLL ("when the console
  # refreshes"); true push is deferred (@m2), parked in
  # BL-246-fleet-console-composite-of-swarms.push.feature.draft. The concrete
  # transport binding (reuse the bridge vs a Pi relay) is OPEN pending the
  # swarm-status publish-format decision — steps are transport-agnostic on
  # purpose. depends_on BL-244.

  Background:
    Given a swarm "alpha" working project "proj-a" publishing to the fleet console
    And a swarm "beta" working project "proj-b" publishing to the fleet console

  # BL-246 fleet-console-01
  Scenario: the console lists every swarm with per-swarm status
    When the console refreshes
    Then it lists swarm "alpha" with its status
    And it lists swarm "beta" with its status

  # BL-246 fleet-console-02
  Scenario: fleet status is the rollup of its swarms
    Given swarm "alpha" status is active
    And swarm "beta" status is blocked
    When the console reads status() for the fleet
    Then the fleet status reflects that a member is blocked

  # BL-246 fleet-console-03
  Scenario: composite uniformity — one swarm renders like many
    Given only swarm "alpha" is registered
    When the console renders the fleet
    Then it uses the same interface it uses for a multi-swarm fleet
    And no special-case path exists for a single-swarm fleet

  # BL-246 fleet-console-04
  Scenario: drilling fleet to swarm to agent traverses children() at each level
    When the console reads children() for the fleet
    Then it returns swarm "alpha" and swarm "beta"
    And reading children() on "alpha" returns alpha's agents
    And each agent answers identity(), status(), health(), children()
