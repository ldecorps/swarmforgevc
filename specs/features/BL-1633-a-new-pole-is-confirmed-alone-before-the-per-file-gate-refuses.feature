Feature: BL-1633 A new pole is confirmed alone before the per-file gate refuses

  The unit lane's per-file budget gate (BL-1598) refuses an unregistered
  file at or above 1.5x the 7000 ms budget by reading its duration from
  npm test's own JSON report - measured while the file shares the host
  with the lane's 10-11 concurrent forks. telegramFrontDeskBotCli.test.js,
  3.7-5.0 s alone after BL-1620's cut, measured 8.0, 9.1, 10.5, 12.3,
  12.4, 12.5, 14.3 and 19.7 s in-suite across eight npm test runs with no
  code change, six of eight over the refusal line: the gate's verdict
  flips with the fork pool's contention, not the code. This feature is
  that a would-be new pole is confirmed ALONE before the gate refuses it
  - a file under budget alone is reported as contention with both
  durations and never refuses the run; a file over budget alone too is
  refused exactly as before.

  # BL-1633 new-pole-confirmed-alone-01
  Scenario Outline: a would-be new pole is confirmed alone before the gate decides
    Given a per-file duration report where <file> measures <inSuiteMs> ms in-suite, at or above the refusal line
    And a confirmer that measures <file> alone at <aloneMs> ms
    When the per-file budget guard runs with the confirmer
    Then the verdict is <verdict> and the run <outcome>, naming both durations when the verdict is contention

    Examples:
      | file            | inSuiteMs | aloneMs | verdict    | outcome    |
      | pooled.test.js  | 15000     | 4000    | contention | passes     |
      | genuine.test.js | 15000     | 9000    | new-pole   | is refused |

  # BL-1633 new-pole-confirmed-alone-02
  Scenario: no confirmation for a registered or below-the-line file, at most one confirmation per candidate, and a timeout counts as over budget alone
    Given a per-file duration report where registered.test.js measures 15000 ms in-suite, at or above the refusal line
    And backlog/suite-poles.tsv names registered.test.js under an open ticket
    And a per-file duration report where watched.test.js measures 9000 ms in-suite, under the refusal line
    And a per-file duration report where pooled.test.js measures 15000 ms in-suite, at or above the refusal line
    And a per-file duration report where timedout.test.js measures 15000 ms in-suite, at or above the refusal line
    And a confirmer that measures pooled.test.js alone at 4000 ms, never finishes for timedout.test.js, and records every file it is asked to measure
    When the per-file budget guard runs with the confirmer
    Then the confirmer is never asked about registered.test.js or watched.test.js
    And the confirmer is asked about pooled.test.js exactly once
    And timedout.test.js is a new-pole, refused exactly as today

  # BL-1633 new-pole-confirmed-alone-03
  Scenario: the recorder's real confirmer measures one file alone under the real vitest
    Given a fixture test file that sleeps 200 ms, not under extension/test/
    When the recorder's real confirmer measures it alone
    Then it returns a duration at least 200 ms and under the per-file budget

  # BL-1633 new-pole-confirmed-alone-04
  Scenario: telegramFrontDeskBotCli.test.js is under budget alone and its register row is gone
    Given extension/test/telegramFrontDeskBotCli.test.js at the parcel's own commit
    When it runs alone once under the real vitest
    Then it measures under 7000 ms
    And backlog/suite-poles.tsv has no row for it
    And every other row in backlog/suite-poles.tsv is byte-identical to main
    And BL-1620's feature at the parcel carries scenarios two-unit-lane-poles-01 and -03 only, its narrative stating the register row's fate in the past
    And BL-1598's feature at the parcel carries scenarios unit-suite-pole-register-01 and -02 only, its narrative stating the 2026-09-16 census in the past
