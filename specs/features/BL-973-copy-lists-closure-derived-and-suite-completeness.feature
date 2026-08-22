Feature: BL-973 bb fixture copy-lists follow the real load-file closure, and no test sits unrun

  Four hand-maintained fixture copy-lists of handoff_lib.bb's dependencies
  have been stale since BL-911 added prompt_engine_lib.bb to its load-file
  closure - and test_lean_ledger_bb_wiring.sh has been red for three days
  without anyone noticing, because no standing gate runs it. The durable
  shape already exists (BL-944): derive or gate-check the list from the
  script's real transitive load-file closure, never hand-maintain it bare.

  Background:
    Given the bb test tree "swarmforge/scripts/test"

  # BL-973 copy-lists-closure-derived-and-suite-completeness-01
  Scenario: the lean-ledger wiring fixture runs green
    When "swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh" runs
    Then it exits 0

  # BL-973 copy-lists-closure-derived-and-suite-completeness-02
  Scenario Outline: a fixture copy-list carries handoff_lib.bb's full closure
    Given the fixture copy-list in "<file>"
    When the list is checked against handoff_lib.bb's transitive load-file closure
    Then no closure file is missing from the list

    Examples:
      | file                                                          |
      | specs/pipeline/steps/bl814LiveRoleHeldLoudDegradeSteps.js     |
      | specs/pipeline/steps/bl487BoardFreshnessWithoutCoordinatorSyncSteps.js |
      | swarmforge/scripts/test/lib/operator_runtime_sandbox.sh       |
      | swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh         |

  # BL-973 copy-lists-closure-derived-and-suite-completeness-03
  Scenario: every bb test file is run by a standing gate or explicitly excluded
    When the standing suite inventory check runs over the bb test tree
    Then every test file is either invoked by the standing suite entry point or listed with a dated reason in the exclusion manifest
