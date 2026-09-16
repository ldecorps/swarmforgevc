Feature: BL-1599 The unit suite work ratchet holds the line

  The whole-suite gate holds a wall-clock number that jitters with host
  load, so it only surfaces and has read over budget since July. The lane
  budget decision delegated to the specifier on 2026-09-16 is summed
  per-file work, fork-independent and stable across hosts: a committed
  550000 ms budget with a 10 percent tolerance, refused above it, lowered
  only. This feature is that refusal, the derived expected wall printed on
  every run with the distance to the operator's 13 s ceiling, and the
  committed number itself.

  # BL-1599 unit-suite-work-ratchet-01
  Scenario Outline: a recorded run is classified against the committed budget and its expected wall is derived
    Given a recorded run with summed per-file work <work> ms, <forks> forks and a slowest file of <pole> ms
    When the work ratchet decides it against a 550000 ms budget with a 10 percent tolerance
    Then the verdict is <verdict> and the run's exit code is <exit>
    And the derived expected wall is <wall> ms, <distance> ms from 13000

    Examples:
      | work   | forks | pole  | verdict        | exit     | wall   | distance |
      | 540000 | 9     | 69900 | ok             | 0        | 69900  | 56900    |
      | 90000  | 9     | 5000  | ok             | 0        | 10000  | 0        |
      | 590000 | 10    | 5000  | over-tolerance | 0        | 59000  | 46000    |
      | 620000 | 1     | 69900 | over-budget    | non-zero | 620000 | 607000   |

  # BL-1599 unit-suite-work-ratchet-02
  Scenario: the committed budget is the delegated number
    When the suite duration budget module is read
    Then SUITE_WORK_BUDGET_MS is 550000 and SUITE_DURATION_BUDGET_MS is still 10000
