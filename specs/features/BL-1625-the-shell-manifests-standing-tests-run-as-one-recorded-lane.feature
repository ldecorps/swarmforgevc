Feature: BL-1625 The shell manifest's standing tests run as one recorded lane

  The shell suite manifest registers 518 tests as standing, and nothing
  runs them as a lane: the registration guards read the manifest, no role's
  lane set includes it, and QA runs only the suites a ticket names. A test
  that turned red the day its own ticket landed stayed red for thirteen
  days (BL-1624). This feature is that one runner executes every standing
  row in manifest order, names any failing row and exits with the suite's
  status, and appends exactly one duration row per completed run - the
  recorder half, changing no lane set and no test. The real manifest run
  is QA's e2e step, not a scenario (BL-1541).

  # BL-1625 shell-manifest-recorded-lane-01
  Scenario: the runner executes exactly the standing rows, in manifest order
    Given a fixture manifest with two standing rows and one non-standing row, each naming a fake test
    When the shell suite runner runs that manifest
    Then it runs exactly the two standing tests
    And it runs them in the manifest's order

  # BL-1625 shell-manifest-recorded-lane-02
  Scenario Outline: the verdict names every failing row and the exit status is the suite's
    Given a fixture manifest whose standing rows <shape>
    When the shell suite runner runs that manifest
    Then it exits <exit>
    And its verdict <names>

    Examples:
      | shape                        | exit | names                       |
      | all pass                     | 0    | names no failing file       |
      | include one that fails       | 1    | names exactly that file     |

  # BL-1625 shell-manifest-recorded-lane-03
  Scenario Outline: one duration row per completed run, none for a killed one
    Given a fixture manifest whose standing rows <shape>
    When the shell suite runner <runs>
    Then the durations file gains <rows> row

    Examples:
      | shape                  | runs                           | rows |
      | all pass               | runs that manifest to the end  | one  |
      | include one that fails | runs that manifest to the end  | one  |
      | all pass               | is killed before the end       | no   |
