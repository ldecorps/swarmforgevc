Feature: The mkTmpDir convention gate covers acceptance step handlers
  BL-743's touched-path mkdtemp convention check scans only
  extension/test/**.js. specs/pipeline/steps/ - the largest
  fixture-creating population in the repository, 436 of 821 handlers
  creating a temp root - sits entirely outside it, which is why the
  leak class keeps recurring there one handler at a time. This slice
  widens the check to touched step handlers and requires the shared
  fixture-root helper, whose exit-time removal makes a root's removal
  reachable from every path that can create it by construction.

  Scope is touched paths only, permanently and by design. The legacy
  population is not migrated here and must not be: a parcel answers for
  the handlers it writes, never for the ones it merely shares a
  repository with.

  Background:
    Given the mkTmpDir convention check is asked about a parcel's touched paths

  # BL-1226 mkdtemp-convention-gate-covers-step-handlers-01
  Scenario: A touched step handler that creates a fixture root outside the shared helper is refused
    Given a step handler "specs/pipeline/steps/exampleLeakSteps.js" that creates a fixture root without the shared helper
    And that handler is among the touched paths
    When the convention check runs
    Then the check reports a violation naming "specs/pipeline/steps/exampleLeakSteps.js" and the offending line number
    And the gate refuses the parcel with "raw mkdtemp outside the shared helper"

  # BL-1226 mkdtemp-convention-gate-covers-step-handlers-02
  Scenario: A touched step handler routed through the shared fixture-root helper passes
    Given a step handler "specs/pipeline/steps/exampleCleanSteps.js" that obtains its fixture root from the shared helper
    And that handler is among the touched paths
    When the convention check runs
    Then the check reports no violations
    And the check records "specs/pipeline/steps/exampleCleanSteps.js" as scanned

  # BL-1226 mkdtemp-convention-gate-covers-step-handlers-03
  Scenario: An untouched legacy step handler holding a fixture root is never scanned
    Given a step handler "specs/pipeline/steps/legacyUntouchedSteps.js" that creates a fixture root without the shared helper
    And that handler is not among the touched paths
    When the convention check runs
    Then the check reports no violations
    And the check records "specs/pipeline/steps/legacyUntouchedSteps.js" as not scanned

  # BL-1226 mkdtemp-convention-gate-covers-step-handlers-04
  Scenario Outline: A fixture root is detected by its route, not by how its base path is spelled
    Given a touched step handler whose fixture root is created with the base expression "<base_expression>"
    When the convention check runs
    Then the check verdict for that handler is "<verdict>"

    Examples:
      | base_expression              | verdict   |
      | os.tmpdir()                  | violation |
      | require('os').tmpdir()       | violation |
      | require('node:os').tmpdir()  | violation |
      | '/tmp'                       | violation |
      | a module-level base constant | violation |
      | the shared fixture-root helper | clean   |

  # BL-1226 mkdtemp-convention-gate-covers-step-handlers-05
  Scenario Outline: Only the convention-bearing test surfaces are classified in scope
    Given the touched path "<path>"
    When the convention check classifies it
    Then the classification is "<classification>"

    Examples:
      | path                                          | classification |
      | extension/test/backlogDepth.test.js           | in-scope       |
      | specs/pipeline/steps/backlogDepthSteps.js     | in-scope       |
      | specs/pipeline/steps/lib/socketFixtureRoot.js | exempt         |
      | extension/test/tmpDirMigrationGuard.test.js   | exempt         |
      | specs/pipeline/runnerAdapter.js               | out-of-scope   |
