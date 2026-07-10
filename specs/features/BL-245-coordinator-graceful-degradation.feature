Feature: graceful degradation when the coordinator dies

  # Baton fleet epic (BL-242) child. Losing the coordinator must not stop work in
  # flight. Workers keep flowing handoffs over the local bus; only
  # convergence-triggering and the fleet-facing identity go dark until respawn.
  # depends_on BL-243.

  Background:
    Given a running swarm "second" with work in flight

  # BL-245 coordinator-degradation-01
  Scenario: workers keep flowing handoffs after the coordinator dies
    When the coordinator pane dies
    Then in-flight worker agents continue running
    And handoffd keeps delivering point-to-point handoffs between them

  # BL-245 coordinator-degradation-02
  Scenario: the swarm reports degraded to the fleet while the coordinator is down
    When the coordinator pane dies
    And the console refreshes
    Then status() for the swarm is "degraded"
    And convergence-triggering is reported unavailable

  # BL-245 coordinator-degradation-03
  Scenario: coordinator respawn re-attaches without losing worker state
    Given the coordinator pane has died
    When the coordinator respawns
    Then it re-reads swarm state from the filesystem event log
    And status() for the swarm clears from "degraded"
    And no in-flight worker state is lost
