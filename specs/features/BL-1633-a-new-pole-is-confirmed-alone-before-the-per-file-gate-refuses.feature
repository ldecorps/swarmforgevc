Feature: BL-1633 A new pole is confirmed alone before the per-file gate refuses

  The unit lane's per-file budget gate reads each file's duration from
  npm test's own report, measured inside the lane's 10-11 forks, and
  refuses any unregistered file at or above 1.5 times the 7000 ms budget.
  The hardener measured telegramFrontDeskBotCli.test.js at 8.0 to 19.7 s
  in-suite across eight runs at load below 8, six of them over the line,
  while the file is 3.7 to 5.0 s alone - the verdict follows the pool's
  contention, not the code. This feature is that a suspected new pole is
  confirmed alone before the gate refuses, that one under budget alone is
  reported as contention with both durations and never refuses the run,
  that the confirmation is bounded and is not a bypass, that the recorder
  passes a real confirmer, and that the file's own register row leaves
  in this land. One full npm test run is QA's e2e step, not a scenario
  (BL-1541).

  Background:
    Given a pole register with no row for the file under test

  # BL-1633 new-pole-confirmed-alone-01
  Scenario Outline: an unregistered file over the line is refused only when it is over budget alone too
    Given a per-file duration report where an unregistered file measures <in-suite> ms
    And the file measures <alone> when confirmed alone
    When the per-file budget guard runs with a 7000 ms budget and the confirmer
    Then the verdict is <verdict>
    And the run <outcome>
    And the verdict line <names>

    Examples:
      | in-suite | alone            | verdict    | outcome     | names                                        |
      | 12400    | 4800 ms          | contention | passes      | names the file with 12400 ms and 4800 ms     |
      | 12400    | 9100 ms          | new-pole   | is refused  | names the file as exceeding the budget       |
      | 19700    | no result at all | new-pole   | is refused  | names the file as unconfirmed within 21000 ms |

  # BL-1633 new-pole-confirmed-alone-02
  Scenario Outline: the confirmation is bounded to would-be offenders, once each
    Given a per-file duration report where <report>
    When the per-file budget guard runs with a 7000 ms budget and the confirmer
    Then the confirmer was called <calls>

    Examples:
      | report                                                              | calls                    |
      | an unregistered file measures 8000 ms                               | 0 times                  |
      | a registered file with an open owner measures 12400 ms              | 0 times                  |
      | two unregistered files measure 12400 ms and 15000 ms                | exactly once per file    |

  # BL-1633 new-pole-confirmed-alone-03
  Scenario: the recorder's real confirmer measures one file alone under the unit config
    Given a fixture test file whose one test sleeps 200 ms
    When the recorder's confirmer measures that file alone
    Then it reports a duration of at least 200 ms
    And it ran vitest with exactly that one file

  # BL-1633 new-pole-confirmed-alone-04
  Scenario: the file that surfaced the gap is under budget alone and its row is gone
    When extension/test/telegramFrontDeskBotCli.test.js runs alone once under the unit config
    Then it measures under 7000 ms
    And backlog/suite-poles.tsv at the parcel has no row for it and every other row byte-identical to main
