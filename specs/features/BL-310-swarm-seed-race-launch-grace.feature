Feature: A freshly (re)started runtime never auto-hibernates before the coordinator can triage queued work

  # BL-310 swarm-seed-race-01
  Scenario: within the launch grace window, the closing pass never hibernates
    Given the runtime started less than 2 minutes ago
    And no promotable backlog work remains
    And every role in the current roster has an empty inbox and no in-process task
    When the runtime evaluates the closing pass
    Then it does not hibernate

  # BL-310 swarm-seed-race-02
  Scenario: once the grace window has elapsed, the closing pass hibernates as before
    Given the runtime started more than 2 minutes ago
    And no promotable backlog work remains
    And every role in the current roster has an empty inbox and no in-process task
    When the runtime evaluates the closing pass
    Then it hibernates the swarm

  # BL-310 swarm-seed-race-03
  Scenario: fresh coordinator mail wakes a hibernated swarm even with no promotable ticket yet
    Given the swarm is hibernated
    And no promotable backlog work remains
    And fresh coordinator mail has arrived
    When the runtime evaluates the closing pass
    Then the runtime relaunches the swarm

  # BL-310 swarm-seed-race-04
  Scenario: a hibernated swarm stays hibernated with no fresh mail and no promotable work
    Given the swarm is hibernated
    And no promotable backlog work remains
    And no fresh coordinator mail has arrived
    When the runtime evaluates the closing pass
    Then the swarm remains hibernated
