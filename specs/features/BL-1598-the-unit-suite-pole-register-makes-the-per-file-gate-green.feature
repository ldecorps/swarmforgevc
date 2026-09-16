Feature: BL-1598 The unit suite pole register makes the per-file gate green

  BL-378's per-file 7-second gate has had live offenders since August and
  fails every npm test, so a new pole is indistinguishable from an old one
  and every recorded run reads fail. This feature is that a committed pole
  register in the standing-red register's shape lets the gate refuse only
  a new offender, a stale row or an unowned row, that the recorded run
  keeps the test outcome apart from the budget verdict, and that the nine
  poles measured on 2026-09-16 are registered with an open owner.

  # BL-1598 unit-suite-pole-register-01
  Scenario Outline: the per-file gate decides against the register
    Given a per-file duration report where <report>
    And a pole register that <register>
    When the per-file budget guard runs with a 7000 ms budget
    Then the verdict is <verdict>

    Examples:
      | report                                    | register                                      | verdict                                   |
      | one file measures 9000 ms                 | names that file with an open owner            | ok, the file reported as a registered pole |
      | one file measures 9000 ms                 | is empty                                      | new-pole naming the file and 9000 ms       |
      | every file measures under 5000 ms         | names one of them with an open owner          | stale-row naming that file                 |
      | one file measures 9000 ms                 | names that file with a closed or absent owner | unowned-row naming the file and its owner  |
      | every file measures under 7000 ms         | is empty                                      | ok                                         |

  # BL-1598 unit-suite-pole-register-02
  Scenario Outline: the recorded run keeps the test outcome apart from the budget verdict
    Given a test exit code of <test-exit> and a guard verdict of <verdict>
    When the recorder builds the run's row
    Then the row's result is <result> and its budget_verdict is <verdict>
    And the run's exit code is <exit>

    Examples:
      | test-exit | verdict  | result | exit     |
      | 0         | ok       | pass   | 0        |
      | 0         | new-pole | pass   | non-zero |
      | 1         | ok       | fail   | 1        |

  # BL-1598 unit-suite-pole-register-03
  Scenario: the committed register names the nine poles of 2026-09-16 with an open owner each
    When backlog/suite-poles.tsv is read
    Then it holds exactly 9 rows
    And every row names a ticket present under backlog/paused or backlog/active
    And bl968StepRegistryMaterializedTreeGuard.test.js and telegramFrontDeskBotCli.test.js are among the files
