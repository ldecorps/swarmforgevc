Feature: launchSwarm reports a spawn failure deterministically, regardless of user or filesystem

  # BL-219 spawn-fail-01
  Scenario: launchSwarm resolves failure when its start script cannot be spawned
    Given a swarm start script that cannot be spawned
    When launchSwarm runs
    Then it resolves failure with a "Failed to start swarm" message

  # BL-219 spawn-fail-02
  Scenario: the unspawnable condition is forced without permission bits
    Given the failure is induced via a non-existent path or an injected spawn error
    When the suite runs as root or on a filesystem that ignores mode bits
    Then launchSwarm still observes the spawn failure

# Non-behavioral gates:
#  - No chmod 0000 / permission-bit failure simulation anywhere in the suite;
#    the failure is deterministic across root/WSL/mounted filesystems.
#  - Same observable assertion as before (success === false, "Failed to start
#    swarm"); test stays instant, no real timers.
#  - Sweep for sibling permission-based failure sims and convert them too.
