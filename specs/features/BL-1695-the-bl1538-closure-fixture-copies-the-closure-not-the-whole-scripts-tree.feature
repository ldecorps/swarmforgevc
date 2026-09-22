Feature: BL-1695 the bl1538 closure fixture copies the closure, not the whole scripts tree

  bl1538Bl1028RunnerFixtureClosureInvariants copies every file under
  swarmforge/scripts (496 files, 16 MB) into a scratch root for each of
  its eight closure-member iterations and spawns bb twice, and none of
  its assertions says which cause it failed on. In QA's full property
  lane at load ten it went red with a counterexample and no text, while
  it is green alone in under a second. The fixture now copies only the
  closure plus the runner, and every assertion names the member and the
  reason. Reproducing the lane red once, with its text, is QA's e2e
  step and the parcel's evidence, not a scenario.

  Background:
    Given the property file's fixture helpers are loaded from extension/test

  # BL-1695 closure-fixture-copies-only-the-closure-01
  Scenario: the scratch tree the fixture builds holds the closure and the runner and nothing else
    When the fixture builds its scratch scripts tree under a temporary root
    Then the root holds exactly the closure of promotion_gates_cli.bb as .bb files
    And the runner is present under the root's test directory
    And no other file from swarmforge/scripts was copied

  # BL-1695 closure-fixture-copies-only-the-closure-02
  Scenario: every assertion in invariant 2 names the member under test and the cause
    When the source of the property file is read
    Then each assertion message in the invariant-2 property interpolates the removed member
    And the subprocess assertion carries the runner's stderr and the presence assertion carries the observed copy set
