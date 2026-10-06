Feature: BL-2021 The shell front-end runs exactly the standing rows, in manifest order

  run_bb_suite.sh (BL-973) runs the shell suite manifest's standing tests
  on demand and names its reds, but no role's lane or slot calls it and no
  run records what a test costs, so test_bl1388_land_step_guard_fixture.sh
  stayed red for thirteen days (BL-1624). The shell front-end lists exactly
  the manifest's standing rows in manifest order and runs them on
  BL-2019's recorded lane runner, so each run leaves one duration row per
  test.

  Moved verbatim from BL-1625 (split 2026-10-06 into BL-2019, BL-2020 and
  BL-2021 after the iq3 coder loop-halted on it).

  # BL-2021 recorded-lane-runner-01
  Scenario: the shell front-end runs exactly the standing rows, in manifest order
    Given a fixture manifest with two standing rows and one non-standing row, each naming a fake test
    When the shell suite front-end runs that manifest
    Then it runs exactly the two standing tests
    And it runs them in the manifest's order
