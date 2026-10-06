Feature: BL-2027 The recorded lane runner names every red and runs a bounded prefix

  The recorded lane runner runs a listed population one item at a time in
  the list's order, names every failing item in its verdict, exits with the
  suite's status, and runs a bounded prefix under a limit. Every scenario
  runs on a fixture list under mkdtemp.

  Moved verbatim from BL-2019 (split 2026-10-06 into BL-2027 and BL-2028
  after the iq3 coder loop-halted on it), and to BL-2019 from BL-1625.

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

  # BL-2027 recorded-lane-runner-06
  Scenario: the duration rows stay whole milliseconds where date has no %3N
    Given a fixture list whose two items both pass
    And a date on PATH that prints %3N literally, as BSD date does
    When the recorded lane runner runs that list to the end
    Then every row's duration_ms is a whole number of milliseconds
