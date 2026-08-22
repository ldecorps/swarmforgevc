Feature: The extension unit suite's latest recorded run is green and profiled
  The suite's last recorded run is 169.5s across 438 files AND it failed, with
  workers being terminated mid-run. A failing run is not a baseline: until the
  run is green, nobody knows how much of that 169.5s is test work and how much
  is workers dying and their files being redone. This slice makes the run
  complete green and publishes where its time actually goes, so the cut that
  follows targets measured poles instead of guesses.
  Source: backlog/INTAKE-unit-suite-under-13s.md.

  Background:
    Given the extension unit suite has been run on an otherwise-idle host

  # BL-791 unit-suite-green-and-profiled-01
  Scenario: the recorded run passed
    When the duration record is read
    Then it shows the run passed
    And it carries the run's wall-clock duration

  # BL-791 unit-suite-green-and-profiled-02
  Scenario: no worker was terminated during the run
    When the run's outcome is read
    Then no worker was terminated during the run

  # BL-791 unit-suite-green-and-profiled-03
  Scenario: the run is profiled per test file
    When the per-file duration report is read
    Then every test file that ran is listed with its own duration
    And the slowest test files are listed first

  # BL-791 unit-suite-green-and-profiled-04
  Scenario: the run was not made green by removing tests
    When the duration record is compared with the previous duration record
    Then the recorded test count is not lower than the previous one

  # BL-791 unit-suite-green-and-profiled-05
  Scenario: the poles the next slice must cut are named
    Given the recorded duration is over the thirteen second ceiling
    When the per-file duration report is read
    Then the test files accounting for the bulk of the run are named as poles
    And each named pole carries its own measured duration
