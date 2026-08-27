Feature: The operator_runtime.bb acceptance fixture carries every file it loads

  Four acceptance step handlers build a disposable fixture root by copying a
  hand-maintained list of Babashka files, then shell out to a real
  `bb operator_runtime.bb <root> --tick-once` inside it. Babashka resolves
  every `load-file` relative to the loading file, so a transitive dependency
  absent from that list is absent from the fixture, and the subprocess dies
  with FileNotFoundException before reaching the behaviour under test.

  The list has drifted from the real dependency closure five times. This
  feature makes the closure a checked property rather than a thing somebody
  remembers to update.

  Background:
    Given the tracked Babashka scripts under swarmforge/scripts
    And the fixture dependency list used by the operator_runtime.bb step handlers

  # BL-944 operator-runtime-fixture-dependency-closure-01
  Scenario: The declared list covers the whole transitive load-file closure
    When the transitive load-file closure of operator_runtime.bb is computed from source
    Then every file in that closure is present in the fixture dependency list

  # BL-944 operator-runtime-fixture-dependency-closure-02
  Scenario Outline: A dependency missing from the list is reported, at any depth
    Given a fixture dependency list from which "<omitted>" has been removed
    When the closure check runs against that list
    Then the check fails
    And it names "<omitted>" as missing from the list

    Examples:
      | omitted                      |
      | handoff_lib.bb               |
      | mono_router_lib.bb           |
      | process_table_lib.bb         |

  # BL-944 operator-runtime-fixture-dependency-closure-03
  Scenario: A listed file the closure never reaches must be declared, not silently carried
    Given a fixture dependency list carrying an entry no load-file chain reaches
    And that entry is not declared as needed by a non-load-file mechanism
    When the closure check runs against that list
    Then the check fails
    And it names that entry as unreachable and undeclared

  # BL-944 operator-runtime-fixture-dependency-closure-04
  Scenario: A fixture root built from the list runs operator_runtime.bb without a load failure
    Given a disposable fixture root populated from the fixture dependency list
    When bb operator_runtime.bb is run against that root with --tick-once
    Then no FileNotFoundException is raised while loading Babashka sources
