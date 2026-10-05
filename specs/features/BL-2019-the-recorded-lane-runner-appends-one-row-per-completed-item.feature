Feature: BL-2019 The recorded lane runner appends one duration row per completed item

  Neither registered test population has a duration record: the shell
  suite manifest's standing tests (run on demand by run_bb_suite.sh,
  BL-973, but by no role's lane or slot) and the landed feature files
  under specs/features/ (run by nobody beyond each ticket's own). One
  runner executes a listed population one item at a time in the list's
  order, appends exactly one duration row per completed item and none for
  an incomplete one, names every red in its verdict, exits with the
  suite's status, and runs a bounded prefix under a limit. Every scenario
  runs on a fixture list under mkdtemp; the real populations are BL-2020's
  and BL-2021's front-ends.

  Moved verbatim from BL-1625 (split 2026-10-06 into BL-2019, BL-2020 and
  BL-2021 after the iq3 coder loop-halted on it).

  # BL-2019 recorded-lane-runner-03
  Scenario Outline: one row per completed item, none for an incomplete one
    Given a fixture list whose two items <shape>
    When the recorded lane runner <runs>
    Then the durations file holds <rows>

    Examples:
      | shape                  | runs                       | rows                              |
      | both pass              | runs that list to the end  | one row per item, both passing    |
      | include one that fails | runs that list to the end  | one row per item, one failing     |
      | both pass              | is killed after the first  | exactly one row                   |

  # BL-2019 recorded-lane-runner-04
  Scenario Outline: the verdict names every failing item and the exit status is the suite's
    Given a fixture list whose two items <shape>
    When the recorded lane runner runs that list to the end
    Then it exits <exit>
    And its verdict <names>

    Examples:
      | shape                  | exit | names                       |
      | both pass              | 0    | names no failing item       |
      | include one that fails | 1    | names exactly that item     |

  # BL-2019 recorded-lane-runner-05
  Scenario: a limit runs a bounded prefix of the list
    Given a fixture list whose two items both pass
    When the recorded lane runner runs that list with a limit of 1
    Then it runs exactly the first item
    And the durations file holds exactly one row
