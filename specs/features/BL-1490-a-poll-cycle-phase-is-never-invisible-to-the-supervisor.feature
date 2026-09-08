Feature: BL-1490 a poll-cycle phase is never invisible to the supervisor

  BL-977 taught the supervisor to read the daemon's in-flight sweep marker so a
  long sweep is not mistaken for silence. The marker is written only by
  run-sweep!, and the poll cycle has phases that run outside it: startup-notify
  before the loop, outbox delivery (poll-once!) and the canary sweep on every
  tick. On 2026-09-08 at 03:44:28Z the daemon had written its cycle-start
  heartbeat at 03:43:54Z and was delivering four coordinator notes at about
  nine seconds each; the marker read idle, the heartbeat file was 34 s old, the
  oldest undelivered outbox parcel was 36 s old, and evaluate-health ruled
  :stalled. alarm-and-halt killed every role session. The same shape ended 65
  of the 150 halts on record: 41 in startup-notify, 24 in delivery.

  Background:
    Given a supervisor whose stall threshold is 3000 ms
    And the daemon process is alive

  # BL-1490 poll-phase-never-invisible-01
  Scenario Outline: a per-tick phase that is making progress is never judged stalled
    Given a fixture daemon cycle whose "<phase>" phase completes <units> units of work each costing 900 ms
    And pending outbox mail older than the stall threshold
    When the supervisor evaluates health every 500 ms until the phase completes
    Then every health verdict reads "healthy"
    And the swarm halt is never invoked
    And all <units> units of work completed

    Examples:
      | phase          | units |
      | delivery       | 4     |
      | delivery       | 5     |
      | startup-notify | 5     |

  # BL-1490 poll-phase-never-invisible-02
  Scenario: a phase that stops making progress is still caught, and halted once
    Given a fixture daemon cycle whose "delivery" phase freezes after its first unit of work
    And pending outbox mail older than the stall threshold
    When the supervisor evaluates health repeatedly past the phase budget
    Then the health verdict becomes "stalled"
    And the swarm halt is invoked once

  # BL-1490 poll-phase-never-invisible-03
  Scenario: a silent daemon with nothing in flight still halts within one stall window
    Given the heartbeat file has not been touched for 61803 ms
    And the sweep marker reads idle
    And pending outbox mail older than the stall threshold
    When the supervisor evaluates health once
    Then the health verdict reads "stalled"
