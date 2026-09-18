Feature: BL-1598 The unit suite pole register makes the per-file gate green

  BL-378's per-file 7-second gate has had live offenders since August and
  fails every npm test, so a new pole is indistinguishable from an old one
  and every recorded run reads fail. This feature is that a committed pole
  register in the standing-red register's shape lets the gate refuse only
  a new offender at or above 1.5x the budget or an unowned row - a bare
  breach of the budget (watch) and a registered file that has fallen well
  under budget (stale-row) are reported on every run, never refused, since
  a snapshot gate that refuses on ordinary host-load jitter is red on day
  one (amended 2026-09-16 on QA's Article 4.2 hold) - that the recorded run
  keeps the test outcome apart from the budget verdict, and that the nine
  poles measured on 2026-09-16 were registered with an open owner (the
  census pin retired by BL-1633 as rows drain).

  # BL-1598 unit-suite-pole-register-01
  Scenario Outline: the per-file gate decides against the register
    Given a per-file duration report where <report>
    And a pole register that <register>
    When the per-file budget guard runs with a 7000 ms budget
    Then the verdict is <verdict>

    Examples:
      | report                             | register                                      | verdict                                     |
      | one file measures 9000 ms          | names that file with an open owner            | ok, the file reported as a registered pole  |
      | one file measures 9000 ms          | is empty                                      | watch naming the file and 9000 ms, exit 0   |
      | one file measures 11000 ms         | is empty                                      | new-pole naming the file and 11000 ms       |
      | every file measures under 5000 ms  | names one of them with an open owner          | stale-row reported naming that file, exit 0 |
      | one file measures 9000 ms          | names that file with a closed or absent owner | unowned-row naming the file and its owner   |
      | every file measures under 7000 ms  | is empty                                      | ok                                          |

  # BL-1598 unit-suite-pole-register-02
  Scenario Outline: the recorded run keeps the test outcome apart from the budget verdict
    Given a test exit code of <test-exit> and a guard verdict of <verdict>
    When the recorder builds the run's row
    Then the row's result is <result> and its budget_verdict is <verdict>
    And the run's exit code is <exit>

    Examples:
      | test-exit | verdict   | result | exit     |
      | 0         | ok        | pass   | 0        |
      | 0         | new-pole  | pass   | non-zero |
      | 1         | ok        | fail   | 1        |
      | 0         | watch     | pass   | 0        |
      | 0         | stale-row | pass   | 0        |
