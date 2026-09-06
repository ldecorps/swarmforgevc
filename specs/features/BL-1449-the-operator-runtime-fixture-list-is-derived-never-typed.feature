Feature: BL-1449 The operator_runtime.bb fixture dependency list is derived at load, never typed

  OPERATOR_RUNTIME_BB_FILES (specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js)
  is the hand-typed list of Babashka files five acceptance step handlers copy
  into a disposable root before running operator_runtime.bb. BL-944 made the
  real transitive load-file closure a checked property by deriving it from
  source and comparing; the list has still drifted three more times since
  (the seventh drift was BL-1265, the eighth was fixed inside BL-1439 on
  2026-09-06), each one a standing red in the unit suite until somebody
  retyped the list. A list that is checked against a derivation but typed
  by hand drifts every time a load-file is added; a list that IS the
  derivation cannot. This feature is that the export is computed from the
  walk at module load, plus the declared extras, so a new load-file in the
  tree is in the fixture the moment it exists, and BL-944's guard keeps
  checking the walk's honesty against seeded lists exactly as before.

  Background:
    Given the tracked Babashka scripts under swarmforge/scripts

  # BL-1449 the-export-equals-the-walk-01
  Scenario: the exported fixture list equals the transitive closure of operator_runtime.bb plus the declared extras
    When the fixture dependency list module is loaded
    Then its exported list equals the closure computed from source, plus the declared extras, in a stable order

  # BL-1449 a-new-load-file-is-in-the-fixture-without-any-edit-02
  Scenario: a load-file added to a scratch copy of the tree appears in the list with no edit to the module
    Given a scratch copy of swarmforge/scripts where one closure file gains a load-file of a new script
    When the fixture dependency list module is loaded against the scratch copy
    Then the new script is in the exported list
    And the module's source is unchanged

  # BL-1449 the-fixture-still-boots-the-runtime-03
  Scenario: a fixture root populated from the derived list runs operator_runtime.bb without a load failure
    Given a disposable fixture root populated from the derived list
    When bb operator_runtime.bb is run against that root with --tick-once
    Then no FileNotFoundException is raised while loading Babashka sources
