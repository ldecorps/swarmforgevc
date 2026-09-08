Feature: BL-1492 a stalled verdict restarts the daemon in place, and the full halt is the escalation

  BL-144 answers a dead or stalled daemon by killing every role session and
  waiting for a human. babysitterd now repairs every such halt unattended a
  few minutes later, so the wait never happens and each halt only costs nine
  agents their in-flight context. The supervisor restarts the daemon in place
  under a bounded budget, still alarming and recording every restart, and
  escalates to the unchanged BL-144 halt when the budget is spent.

  Background:
    Given a fixture project root whose daemon start owner, alarm email and swarm halt are recorded, not performed
    And a supervisor whose restart budget is 2 restarts per 600000 ms

  # BL-1492 restart-in-place-01
  Scenario: the first stalled verdict restarts the daemon and touches no role session
    When the supervisor acts on a "stalled" verdict
    Then the daemon start owner is invoked once
    And the swarm halt is never invoked
    And one alarm email is sent naming a restart
    And the status file records a "succeeded" restart in restart_history

  # BL-1492 restart-in-place-02
  Scenario: a dead verdict takes the same path as a stalled one
    When the supervisor acts on a "dead" verdict
    Then the daemon start owner is invoked once
    And the swarm halt is never invoked

  # BL-1492 restart-in-place-03
  Scenario: an exhausted budget is BL-144's halt, unchanged
    Given the supervisor has already restarted the daemon 2 times within the window
    When the supervisor acts on a "stalled" verdict
    Then the daemon start owner is not invoked
    And the swarm halt is invoked once
    And the status file reads "halted"

  # BL-1492 restart-in-place-04
  Scenario: a healthy uptime window re-arms the budget
    Given the supervisor has already restarted the daemon 2 times within the window
    And the daemon has since been healthy for longer than the window
    When the supervisor acts on a "stalled" verdict
    Then the daemon start owner is invoked once
    And the swarm halt is never invoked

  # BL-1492 restart-in-place-05
  Scenario: a start owner that fails counts against the budget and is not retried in the same check
    Given the daemon start owner fails
    When the supervisor acts on a "stalled" verdict
    Then the daemon start owner is invoked once
    And the status file records a "failed" restart in restart_history
