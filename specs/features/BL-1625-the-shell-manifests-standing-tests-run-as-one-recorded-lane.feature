Feature: BL-1625 A registered test population runs as one recorded lane

  Two registries are read for registration and run by nobody: the shell
  suite manifest's 518 standing tests and the 1294 landed feature files
  under specs/features/. A shell test red since its own ticket landed
  stayed red for thirteen days (BL-1624); four landed features stayed red
  for weeks (BL-1626, BL-1627). This feature is that one runner executes
  a listed population one item at a time in the population's own order,
  appends exactly one duration row per completed item and none for an
  incomplete one, names every red in its verdict and exits with the
  suite's status; that a shell-manifest front-end lists exactly the
  standing rows and a landed-features front-end lists every feature in
  name order; and that a limit runs a bounded prefix of the list. The
  real populations run only as bounded samples in QA's e2e step and in
  full in the nightly slot after landing - never as a scenario (BL-1541).

  # BL-1625 recorded-lane-runner-01
  Scenario: the shell front-end runs exactly the standing rows, in manifest order
    Given a fixture manifest with two standing rows and one non-standing row, each naming a fake test
    When the shell suite front-end runs that manifest
    Then it runs exactly the two standing tests
    And it runs them in the manifest's order

  # BL-1625 recorded-lane-runner-02
  Scenario: the features front-end runs every feature in the directory, in name order
    Given a fixture features directory holding two one-scenario features with registered handlers
    When the landed-features front-end runs that directory to the end
    Then it runs exactly those two features
    And it runs them in name order

  # BL-1625 recorded-lane-runner-03
  Scenario Outline: one row per completed item, none for an incomplete one
    Given a fixture list whose two items <shape>
    When the recorded lane runner <runs>
    Then the durations file holds <rows>

    Examples:
      | shape                  | runs                       | rows                              |
      | both pass              | runs that list to the end  | one row per item, both passing    |
      | include one that fails | runs that list to the end  | one row per item, one failing     |
      | both pass              | is killed after the first  | exactly one row                   |

  # BL-1625 recorded-lane-runner-04
  Scenario Outline: the verdict names every failing item and the exit status is the suite's
    Given a fixture list whose two items <shape>
    When the recorded lane runner runs that list to the end
    Then it exits <exit>
    And its verdict <names>

    Examples:
      | shape                  | exit | names                       |
      | both pass              | 0    | names no failing item       |
      | include one that fails | 1    | names exactly that item     |

  # BL-1625 recorded-lane-runner-05
  Scenario: a limit runs a bounded prefix of the list
    Given a fixture list whose two items both pass
    When the recorded lane runner runs that list with a limit of 1
    Then it runs exactly the first item
    And the durations file holds exactly one row
