Feature: Fixture script closure preserves dependency paths

  A test fixture's swarmforge/scripts/ tree is built from the transitive
  load-file closure of the entry points the test actually invokes, rather
  than by copying the whole live directory (BL-1038). Two things must hold
  for that fixture to be a faithful stand-in for the live tree: a
  dependency's LOCATION within the tree has to survive the copy, and a
  dependency that cannot be resolved has to fail the build naming it.

  If neither holds, the fixture ends up quietly smaller than the closure
  it was asked for, and the omission surfaces far away - as an unrelated
  invariant violation in a different file, attributed to a subsystem that
  is working correctly.

  Background:
    Given a live scripts directory

  # BL-1294 fixture-script-closure-preserves-dependency-paths-01
  Scenario Outline: a dependency keeps its location in the fixture
    Given "caller.bb" load-files the dependency "<dependency>"
    And the live scripts directory has a file at "<dependency>"
    When the closure of "caller.bb" is copied into a fixture scripts directory
    Then the fixture has a file at "<dependency>"

    Examples:
      | dependency                  |
      | sibling_lib.bb              |
      | test/suite_inventory_lib.bb |

  # BL-1294 fixture-script-closure-preserves-dependency-paths-02
  Scenario: an unresolvable dependency fails the copy naming it
    Given "caller.bb" load-files the dependency "test/absent_lib.bb"
    And the live scripts directory has no file at "test/absent_lib.bb"
    When the closure of "caller.bb" is copied into a fixture scripts directory
    Then the copy fails naming "test/absent_lib.bb"

  # BL-1294 fixture-script-closure-preserves-dependency-paths-03
  Scenario: a copied entry point loads every dependency it reaches
    Given the live "swarm_handoff.bb" reaches a dependency held in a subdirectory
    When the closure of "swarm_handoff.bb" is copied into a fixture scripts directory
    And a note draft is handed to the fixture's "swarm_handoff.bb"
    Then the script loads every dependency it reaches without a missing-file error
