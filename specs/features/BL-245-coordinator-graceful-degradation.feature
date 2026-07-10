Feature: the swarm stops gracefully when the coordinator is lost

  # Baton fleet epic (BL-242) child, RE-SPECCED (operator 2026-07-10 inversion):
  # losing the coordinator no longer leaves the swarm running in a "degraded" mode.
  # Instead the swarm attempts a BOUNDED respawn of the coordinator; if that is
  # exhausted it STOPS gracefully — freeze intake, let each in-flight parcel finish
  # its current stage and commit, then tear down handoffd and every role session
  # with no orphans. The fleet then sees a terminal "stopped (coordinator lost)"
  # status; a human relaunches (no auto-restart). This COMPLEMENTS the
  # constitution's BL-107 (the coordinator must never DELIBERATELY exit; a
  # sanctioned restart is a bounce) by governing UNEXPECTED coordinator loss.
  # depends_on BL-243.

  Background:
    Given a running swarm "second" with work in flight

  # BL-245 respawn-recovers-01
  Scenario: a transient coordinator loss is recovered by a bounded respawn
    When the coordinator pane dies
    And in-flight worker agents keep running during the respawn attempts
    And a respawn attempt succeeds within the attempt cap
    Then the coordinator re-reads swarm state from durable filesystem state
    And no in-flight worker state is lost
    And the swarm returns to normal status

  # BL-245 exhausted-respawn-stops-02
  Scenario: when the bounded respawn is exhausted the swarm stops gracefully
    When the coordinator pane dies
    And every respawn attempt fails up to the attempt cap
    Then the swarm stops gracefully rather than continuing in a degraded mode

  # BL-245 graceful-stop-quiesces-03
  Scenario: a graceful stop drains in-flight work before tearing down
    Given the swarm is stopping gracefully after coordinator loss
    When the stop proceeds
    Then no new work is promoted
    And each in-flight parcel finishes its current stage and commits
    And handoffd and every role session are then torn down with no orphaned processes

  # BL-245 fleet-terminal-stopped-04
  Scenario: the fleet sees a terminal stopped status and does not auto-restart
    Given the swarm has stopped gracefully after coordinator loss
    When the fleet console refreshes
    Then status() for the swarm is "stopped (coordinator lost)"
    And the swarm is not automatically restarted
