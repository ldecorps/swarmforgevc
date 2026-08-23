# mutation-stamp: sha256=41dd8cf33bb49cdda62fd742b0bf95412a5095fae266369a8b9bde0c9cad8070
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T01:51:30.046309752Z","feature_name":"BL-973 bb fixture copy-lists follow the real load-file closure, and no test sits unrun","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-973-copy-lists-closure-derived-and-suite-completeness.feature","background_hash":"d4947a066d6e3dbeaef866657a00e786c004fe425a4ab0461f1b62ea622321c7","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a fixture copy-list carries its own entry point's full closure","scenario_hash":"c8195fdfb870f91c3f63ef7465ecddca4ec018dc55c4d6be80fbc8a42eb3cdab","mutation_count":10,"result":{"Total":10,"Killed":10,"Survived":0,"Errors":0},"tested_at":"2026-08-23T01:51:30.046309752Z"},{"index":2,"name":"a new load-file edge upstream fails every guarded list loudly","scenario_hash":"52d7c67369fd70945f8ba8fb1df98e99d0a35d23d6357860f85522e39a9e4b09","mutation_count":5,"result":{"Total":5,"Killed":5,"Survived":0,"Errors":0},"tested_at":"2026-08-23T01:51:30.046309752Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-973 bb fixture copy-lists follow the real load-file closure, and no test sits unrun

  Five hand-maintained fixture copy-lists name a bb script's dependencies by
  hand, and nothing gates them against the real closure. They have drifted
  three times: BL-911 added prompt_engine_lib.bb to handoff_lib.bb's closure,
  BL-967 added daemon_cycle_guard_lib.bb, and BL-1029 adds shell_quote_lib.bb.
  Two acceptance features (BL-487, BL-814) and test_lean_ledger_bb_wiring.sh
  sit red on main because of it, the shell test unnoticed for days because no
  standing gate runs it. The durable shape already exists (BL-944): derive or
  gate-check each list against the transitive load-file closure of the entry
  point that fixture actually drives - never hand-maintain it bare. The entry
  point is per-list and not always handoff_lib.bb, so a guard pinned to one
  script would green a fixture missing its own CLI's direct dependency.

  Background:
    Given the bb test tree "swarmforge/scripts/test"

  # BL-973 copy-lists-closure-derived-and-suite-completeness-01
  Scenario: the lean-ledger wiring fixture runs green
    When "swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh" runs
    Then it exits 0

  # BL-973 copy-lists-closure-derived-and-suite-completeness-02
  Scenario Outline: a fixture copy-list carries its own entry point's full closure
    Given the fixture copy-list in "<file>"
    When the list is checked against the transitive load-file closure of "<entry>"
    Then no closure file is missing from the list

    Examples:
      | file                                                                   | entry                     |
      | specs/pipeline/steps/bl814LiveRoleHeldLoudDegradeSteps.js              | pipeline_stage_cli.bb     |
      | specs/pipeline/steps/bl487BoardFreshnessWithoutCoordinatorSyncSteps.js | pipeline_stage_cli.bb     |
      | extension/test/readLiveRoleHeldTicketsCli.test.js                      | pipeline_stage_cli.bb     |
      | swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh                  | done_with_current_task.bb |
      | swarmforge/scripts/test/lib/operator_runtime_sandbox.sh                | operator_runtime.bb       |

  # BL-973 copy-lists-closure-derived-and-suite-completeness-03
  Scenario Outline: a new load-file edge upstream fails every guarded list loudly
    Given a scratch tree in which "handoff_lib.bb" gains one new load-file edge
    When the fixture copy-list in "<file>" is checked against its entry point's closure
    Then the closure check fails naming the new dependency

    Examples:
      | file                                                                   |
      | specs/pipeline/steps/bl814LiveRoleHeldLoudDegradeSteps.js              |
      | specs/pipeline/steps/bl487BoardFreshnessWithoutCoordinatorSyncSteps.js |
      | extension/test/readLiveRoleHeldTicketsCli.test.js                      |
      | swarmforge/scripts/test/test_lean_ledger_bb_wiring.sh                  |
      | swarmforge/scripts/test/lib/operator_runtime_sandbox.sh                |

  # BL-973 copy-lists-closure-derived-and-suite-completeness-04
  Scenario: every bb test file is run by a standing gate or explicitly excluded
    When the standing suite inventory check runs over the bb test tree
    Then every test file is either invoked by the standing suite entry point or listed with a dated reason in the exclusion manifest

  # BL-973 copy-lists-closure-derived-and-suite-completeness-05
  Scenario: a test file in no runner and no manifest fails the inventory check
    Given a scratch bb test tree containing a test file named in neither the runner nor the exclusion manifest
    When the standing suite inventory check runs over the bb test tree
    Then the inventory check fails naming that test file
