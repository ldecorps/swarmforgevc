Feature: BL-1624 A standing shell test never asserts a diff against main

  test_bl1388_land_step_guard_fixture.sh has failed on main since BL-1388
  landed on 2026-09-04: its step 4 requires land_step_lib_test_runner.bb to
  DIFFER from main, which was true only while BL-1388's own parcel was
  unlanded. Nobody saw it for thirteen days because the shell manifest's
  standing rows are no role's lane. From a fresh clone the same runner also
  fails eight land-step cases as if the land step were wrong, because the
  compiled checker its tree-guard fixture execs does not exist there. This
  feature is that the parcel-time step is retired, that a missing build is
  named loudly before any assertion, and that no standing shell test in
  the manifest asserts on a diff against main. The real green run is
  BL-1388's own scenario 01 and QA's e2e step, not a scenario here
  (BL-1541).

  # BL-1624 standing-shell-test-never-diffs-against-main-01
  Scenario: the parcel-time step is retired and the standing steps are intact
    When the source of swarmforge/scripts/test/test_bl1388_land_step_guard_fixture.sh is read
    Then it runs no git diff against main or origin/main
    And it still carries the step headers for the runner, the discoverable handler, the real guard path and the retired premise

  # BL-1624 standing-shell-test-never-diffs-against-main-02
  Scenario: a tree without the compiled checker fails naming the build, before any runner assertion
    Given a copy of the repository's shell test and runner in a fixture root with no extension/out
    When the shell test runs there
    Then it exits 1 with one line naming extension/out and npm run compile
    And no runner assertion line is printed

  # BL-1624 standing-shell-test-never-diffs-against-main-03
  # Census pin (BL-1445): the population is the manifest's standing rows, counted.
  Scenario: no standing shell test in the manifest asserts on a diff against main
    When the census guard reads every standing row of the shell suite manifest
    Then it names no offending test
    And it reports the number of standing rows it read, and that number is at least 500
