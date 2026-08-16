Feature: Operator watches babysitterd and tells, never restarts

  The Operator runtime polls babysitterd's liveness every tick and reports
  what it finds. Restarting stays with cron. A pidfile is corroborating
  evidence, never the sole source of truth, and only its own process removes it.

  Background:
    Given an Operator runtime with the babysitterd watchdog enabled

  # BL-906 operator-babysitterd-freshness-watchdog-01
  Scenario Outline: Each observable condition classifies to its own state
    Given the babysitterd process is <process>
    And the pidfile is <pidfile>
    And the announce path is <announce>
    When the watchdog classifies babysitterd
    Then the reported state is <state>

    Examples:
      | process | pidfile  | announce | state         |
      | alive   | correct  | working  | healthy       |
      | absent  | absent   | working  | down          |
      | alive   | absent   | working  | pidfile-lie   |
      | alive   | correct  | silent   | announce-mute |

  # BL-906 operator-babysitterd-freshness-watchdog-02
  Scenario: An unhealthy poll tells, and starts nothing
    Given the babysitterd process is absent
    When the Operator runtime ticks
    Then a note is sent to the coordinator
    And the status file records the watchdog state
    And no babysitterd process is started

  # BL-906 operator-babysitterd-freshness-watchdog-03
  Scenario: The Operator runtime has no way to start babysitterd
    When the Operator runtime source is inspected
    Then it contains no call site that starts babysitterd

  # BL-906 operator-babysitterd-freshness-watchdog-04
  Scenario: A second launch does not make a live daemon look down
    Given a live orphaned babysitterd process
    When a second launch is run and exits
    Then the pidfile still names the live process
    And the reported status is not down

  # BL-906 operator-babysitterd-freshness-watchdog-05
  Scenario: A launch adopts a live orphan instead of spawning a second copy
    Given a live orphaned babysitterd process
    When a launch is run
    Then exactly one babysitterd process is running
    And the pidfile names that process

  # BL-906 operator-babysitterd-freshness-watchdog-06
  Scenario: Status reports process truth when the pidfile is gone
    Given a live babysitterd process
    And the pidfile is absent
    When the swarm status is reported
    Then babysitterd is reported as adopted-live

  # BL-906 operator-babysitterd-freshness-watchdog-07
  Scenario: The watchdog can be disabled
    Given the babysitterd watchdog is disabled by its opt-out
    And the babysitterd process is absent
    When the Operator runtime ticks
    Then no note is sent to the coordinator
