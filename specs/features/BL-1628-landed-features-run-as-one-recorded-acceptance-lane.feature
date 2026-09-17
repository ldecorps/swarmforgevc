Feature: BL-1628 Landed features run as one recorded acceptance lane

  A landed feature file is a durable contract, and 1294 of them sit under
  specs/features/ while every role runs only the parcel's own. Four were
  red on main for weeks until a coder's hand-run sweep found them. This
  feature is that one runner executes every feature file in name order,
  appends one row per completed feature with its duration and result,
  names every red and the slowest in its verdict, and exits with the
  suite's status - the recorder half, changing no lane set and no
  feature. The real full run is QA's e2e step, not a scenario (BL-1541).

  # BL-1628 landed-features-recorded-acceptance-lane-01
  Scenario: the runner executes every feature in the directory, in name order
    Given a fixture features directory holding two one-scenario features with registered handlers
    When the full acceptance runner runs that directory to the end
    Then it runs exactly those two features
    And it runs them in name order

  # BL-1628 landed-features-recorded-acceptance-lane-02
  Scenario Outline: one row per completed feature, none for an incomplete one
    Given a fixture features directory whose two features <shape>
    When the full acceptance runner <runs>
    Then the durations file holds <rows>

    Examples:
      | shape                     | runs                            | rows                                 |
      | both pass                 | runs that directory to the end  | one row per feature, both passing    |
      | include one that fails    | runs that directory to the end  | one row per feature, one failing     |
      | both pass                 | is killed after the first       | exactly one row                      |

  # BL-1628 landed-features-recorded-acceptance-lane-03
  Scenario Outline: the verdict names every red feature and the exit status is the suite's
    Given a fixture features directory whose two features <shape>
    When the full acceptance runner runs that directory to the end
    Then it exits <exit>
    And its verdict <names>

    Examples:
      | shape                  | exit | names                          |
      | both pass              | 0    | names no red feature           |
      | include one that fails | 1    | names exactly the red feature  |
