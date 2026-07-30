Feature: Daemon log freshness watchdog

  Background:
    Given watched daemons "handoffd,babysitterd" with heartbeat thresholds "120,600" seconds
    And the freshness checker runs with injected clock, log paths, and announce command

  # BL-675 daemon-log-freshness-01
  Scenario: A sweep daemon heartbeats every loop tick even with no work
    Given a daemon loop completes three ticks during which no work arrives
    Then its log gains three timestamped heartbeat lines

  # BL-675 daemon-log-freshness-02
  Scenario Outline: A stale heartbeat restarts that daemon through its own start script
    Given the "<daemon>" heartbeat is older than its threshold
    When the freshness checker runs
    Then the "<daemon>" process is killed and relaunched via its own start script
    And the durable incident record names "<daemon>" and its heartbeat age
    And the announce command is invoked after the record is written

    Examples:
      | daemon      |
      | handoffd    |
      | babysitterd |

  # BL-675 daemon-log-freshness-03
  Scenario: A quiet but heartbeating daemon is never restarted
    Given the "handoffd" log shows no work lines but a fresh heartbeat
    When the freshness checker runs
    Then no process is killed, no record is written, and no announce is invoked

  # BL-675 daemon-log-freshness-04
  Scenario: A failed announce still leaves the durable incident record
    Given the "handoffd" heartbeat is older than its threshold
    And the announce command fails
    When the freshness checker runs
    Then the "handoffd" process is killed and relaunched via its own start script
    And the durable incident record names "handoffd" and its heartbeat age

  # BL-675 daemon-log-freshness-05
  Scenario: All logs fresh means the checker exits with no side effects
    Given every watched daemon heartbeat is within its threshold
    When the freshness checker runs
    Then no process is killed, no record is written, and no announce is invoked

  # BL-675 daemon-log-freshness-06
  Scenario: A repeat violation inside the cool-off window does not hammer restarts
    Given the "handoffd" heartbeat is older than its threshold
    And a restart of "handoffd" was already recorded inside the cool-off window
    When the freshness checker runs
    Then no second restart is attempted and the escalation announce is invoked
