Feature: BL-1983 The work ratchet does not refuse a run measured under host load

  BL-1599 fails npm test when the suite's summed per-file work exceeds its
  550000 ms budget by more than 10 percent, on the premise that work is
  stable across hosts. Under host load it is not. QA's BL-1958 gather on
  2026-10-05 read 613108 ms of work at 06:59Z with all 1161 tests green, at a
  5-minute load average near 15 on a 20-core host. The same tests read
  391647 ms 24 minutes later. The human ruled the same day, choosing "Skip
  under load".

  This feature is that skip. A run is under host load when its 5-minute load
  average is at or above half the host's logical cores. Such a run still
  prints its work line, marked unmeasured under host load, and never fails
  npm test on the work ratchet. A run below that load is refused exactly as
  BL-1599 decides. Every duration record carries the load and the core count
  it was measured at, so the next quiet run's number can be read against
  them.

  # BL-1983 the-ratchet-exit-depends-on-the-load-01
  Scenario Outline: the work ratchet's exit depends on the host load the run was measured at
    Given a recorded run with summed per-file work <work> ms on a host with 20 logical cores at a 5-minute load average of <load>
    When the work ratchet decides its exit code
    Then the exit code is <exit>
    And the printed work line <marks> the run as unmeasured under host load

    Examples:
      | work   | load | exit     | marks    |
      | 613108 | 15   | 0        | marks    |
      | 613108 | 10   | 0        | marks    |
      | 613108 | 9.9  | non-zero | does not mark |
      | 540000 | 2    | 0        | does not mark |

  # BL-1983 every-record-carries-its-load-02
  Scenario: every duration record carries the load and the core count it was measured at
    Given a recorded run on a host with 20 logical cores at a 5-minute load average of 12.5
    When the run's duration record is written
    Then the record carries a 5-minute load average of 12.5 and 20 cores
