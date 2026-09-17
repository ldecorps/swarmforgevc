Feature: BL-1619 The property lane records its duration and names its pole

  The unit lane has had a duration recorder since BL-078, a per-file
  budget since BL-378, a pole register (BL-1598) and a work ratchet
  (BL-1599); its last row reads 1029 files, pass, 35.8 s wall. The
  property lane - 414 *.property.test.js files, one flat 20 s testTimeout,
  319.94 s wall on 2026-09-16 - has no measurement at all: no row, no
  per-file work, no pole, no verdict. Its reds are found one file at a
  time when the flat timeout fires under load, and each becomes a ticket.
  This feature is the recorder half of the mirror: every completed
  property-lane run appends one row with its files, result, wall, work and
  pole, prints a verdict line naming the pole and the files above half the
  timeout, and changes nothing about what vitest runs or how it exits.

  Background:
    Given an extension checkout whose property lane runs through the recorder

  # BL-1619 property-lane-records-duration-01
  Scenario Outline: every completed run appends one row
    Given the property lane's vitest run <result>
    When npm run test:properties completes
    Then exactly one row is appended to extension/.property-durations.jsonl
    And the row carries finished_at, file_count, result <result>, duration_ms, work_ms, pole_ms and pole_file
    And the command's exit status is vitest's own

    Examples:
      | result |
      | pass   |
      | fail   |

  # BL-1619 property-lane-records-duration-02
  Scenario: the verdict line names the pole and the files above half the timeout
    Given a completed property-lane run whose slowest file took 12 s and two other files took more than 10 s
    When the verdict line is printed
    Then it names the pole file and its seconds
    And it lists the three files above 10 s with their seconds
    And it prints the work sum and the wall in seconds

  # BL-1619 property-lane-records-duration-03
  Scenario: a run that did not complete leaves no row
    Given the property lane's vitest process is killed before it reports
    When the recorder exits
    Then no row is appended and the exit status is non-zero

  # BL-1619 property-lane-records-duration-04
  Scenario: the recorder adds observation only
    Given the same property-lane run with and without the recorder
    When both complete
    Then the set of test files run, their order and the pass/fail result are identical
