Feature: A dead operator runtime is restarted without a human

  Every other long-lived process in this swarm has something that keeps it
  alive: handoffd has handoffd_supervisor, the front-desk trio has
  front_desk_supervisor, the headless bridge has bridge_headless_supervisor.
  operator_runtime.bb has none. A crash leaves a stale pidfile and the
  runtime stays down indefinitely, because the only repair path -
  ensure-operator! in swarm_ensure.bb - runs only when a human types
  ./swarm ensure.

  That is the layer that is supposed to notice when other daemons die, so
  its own silent death is the one failure nothing else reports.

  Background:
    Given a swarm whose operator runtime is expected to be running

  # BL-993 dead-runtime-is-restarted-01
  Scenario Outline: A runtime that is down for any reason is restarted
    Given the operator runtime is down with <down-state>
    When the watch observes it
    Then the operator runtime is started through its normal entry point
    And the restart is announced on the human channel

    Examples:
      | down-state                        |
      | a pidfile naming a dead process   |
      | no pidfile at all                 |
      | a pidfile naming an unrelated pid |

  # BL-993 healthy-runtime-is-left-alone-02
  Scenario: A healthy runtime is never restarted
    Given the operator runtime is running
    When the watch observes it
    Then no restart is attempted
    And nothing is announced on the human channel

  # BL-993 deliberate-stop-is-never-undone-03
  Scenario Outline: A deliberate stop is reported, never reversed
    Given the operator runtime is down with no pidfile at all
    And <stop-signal> is in effect
    When the watch observes it
    Then no restart is attempted
    And the watch reports the runtime as deliberately stopped

    Examples:
      | stop-signal                |
      | the skip-operator env flag |
      | a park flag file           |

  # BL-993 repeated-failure-is-bounded-and-escalated-04
  Scenario: A runtime that will not stay up is bounded and escalated
    Given the operator runtime is down with no pidfile at all
    And every start attempt fails
    When the watch observes it repeatedly
    Then restart attempts are bounded with a growing delay between them
    And the repeated failure is escalated on the human channel

  # BL-993 watch-survives-the-runtime-05
  Scenario: The watch keeps running after the runtime it watches has died
    Given the operator runtime is running
    When the operator runtime dies
    Then the watch is still running
    And the watch observes the death without being restarted itself
