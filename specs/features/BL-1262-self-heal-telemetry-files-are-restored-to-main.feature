Feature: BL-1262 the self-heal telemetry implementation is present at main, and the tests that import it run

  BL-597 landed a self-heal telemetry pair - a pure per-type aggregator and its
  store - plus a Babashka CLI and that CLI's test runner. All four files were
  removed from the tree by a merge, not by any commit that meant to remove
  them, and all four are still absent. What survives is the evidence of the
  loss: two test files that import a module that does not exist, a step handler
  file, a done ticket whose required_wiring names one of the missing paths, and
  three living documents that describe the mechanism as though a reader could
  go and find it.

  The absence is silent in the direction that matters. A missing module reads
  in the suite exactly like a regression someone just introduced, so the red it
  produces has been carried as background noise rather than chased. Restoring
  the files makes the docs true again and returns the suite to a state where a
  red means something.

  This is casualty recovery. The merge machinery that dropped the files is a
  different ticket and is not touched here.

  Background:
    Given the four files BL-597 shipped are absent from main

  # BL-1262 self-heal-telemetry-files-are-restored-to-main-01
  Scenario Outline: every file the merge dropped is present again, and no later commit deletes it
    When the restoration lands
    Then <path> exists at the parcel commit
    And no commit in the parcel deletes <path>

    Examples:
      | path                                                        |
      | extension/src/metrics/selfHealTelemetry.ts                  |
      | extension/src/metrics/selfHealTelemetryStore.ts             |
      | swarmforge/scripts/self_heal_telemetry_cli.bb               |
      | swarmforge/scripts/test/self_heal_telemetry_lib_test_runner.bb |

  # BL-1262 self-heal-telemetry-files-are-restored-to-main-02
  Scenario: the test that could not resolve the module now resolves it and passes
    Given a test file that imports the self-heal telemetry aggregator
    When the unit suite runs
    Then the run reports no unresolved module for that import
    And that test file passes

  # BL-1262 self-heal-telemetry-files-are-restored-to-main-03
  Scenario: the Babashka half is exercised again, not merely present
    When the self-heal telemetry test runner is invoked
    Then it runs to completion and reports success

  # BL-1262 self-heal-telemetry-files-are-restored-to-main-04
  Scenario: the restoration is credited against the tests that already existed, never against rewritten ones
    Given the two test files that import the aggregator are unchanged by this parcel
    When the unit suite runs
    Then both pass against the restored implementation
