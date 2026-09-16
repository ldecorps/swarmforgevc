Feature: BL-1595 The front-desk bot CLI property file derives its 60-second budgets from the lane helper

  During BL-1588's re-verification (2026-09-16) one of five full
  property-lane runs timed out telegramFrontDeskBotCli.property.test.js at
  its own bare 60000 ms third argument, a per-test constant no lane-level
  ceiling can reach, the class BL-1592 owns for bl1529. This feature is
  that both budgeted tests in the file derive their timeout from a 60000 ms
  base through the property lane's budget helper, that the base scales with
  the lane's concurrency the way the 20-second base does, and that the
  parcel's evidence records the full-lane text and the change. The file's
  own green runs are QA's e2e step, not a scenario (BL-1541).

  # BL-1595 front-desk-bot-cli-property-file-derives-its-budgets-01
  Scenario: the file declares no bare per-test timeout and both budgets come from the helper
    When the source of extension/test/telegramFrontDeskBotCli.property.test.js is read
    Then it declares exactly 3 tests
    And it declares exactly 2 per-test timeouts
    And no test in it passes a bare numeric literal as its per-test timeout
    And every per-test timeout it declares is derived from 60000 ms through the property lane's budget helper

  # BL-1595 front-desk-bot-cli-property-file-derives-its-budgets-02
  Scenario Outline: the 60-second base scales with the lane's own concurrency like the 20-second base
    Given the property lane is running <forks> worker forks
    And the host's 1-minute load average reads 1.8, inside the quiet band
    When the per-test budget for the file's fixture-spawning tests is resolved from their 60000 ms base
    Then the effective budget is <outcome>

    Examples:
      | forks | outcome                                          |
      | 1     | exactly 60000 ms                                 |
      | 8     | more than 60000 ms                               |
      | 8     | three times the 8-fork budget of a 20000 ms base |

  # BL-1595 front-desk-bot-cli-property-file-derives-its-budgets-03
  Scenario: the parcel's evidence records the full-lane failure and its remedy
    When BL-1595's evidence file is read
    Then it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it
