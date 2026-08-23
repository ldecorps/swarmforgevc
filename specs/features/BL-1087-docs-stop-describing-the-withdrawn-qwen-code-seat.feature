# mutation-stamp: sha256=b492dde8f674eda9de7c6beea26847c8b0887000593a2f12edfcadbe3c233209
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T11:43:00.292118428Z","feature_name":"Documentation stops describing the withdrawn qwen-code seat","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1087-docs-stop-describing-the-withdrawn-qwen-code-seat.feature","background_hash":"5b992248a20a2e167d634ca53912e5a31829c505970bd4fae011973861ebaea1","implementation_hash":"unknown","scenarios":[{"index":2,"name":"A removed artifact survives only in the shipped-work log","scenario_hash":"97e881f90b1729689a8ac6bfbe49488bb21e735ade7c67f976011a1b20991333","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-23T11:37:16.221111625Z"},{"index":5,"name":"The pre-existing aider-based qwen seat is left untouched","scenario_hash":"e20cf4131366ac125c8c21995a841f312ac61319403618d93aa8959b3c776635","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-23T11:37:16.221111625Z"}]}
# acceptance-mutation-manifest-end

Feature: Documentation stops describing the withdrawn qwen-code seat

  The BL-1052/BL-1053 supersede removed the qwen-code mono-router seat from the
  tree. Its pack conf and prompt overlay, its two step-handler files, its shell
  test and its property runners are all gone, and the disposition recorded in
  backlog/evidence/BL-1052-BL-1053-supersede-disposition-20260823.md is that the
  removal stands.

  The documentation did not follow. A runbook still tells an operator to launch
  a pack that no longer exists, the documentation index still advertises that
  runbook, and the shipped-work log still names the removed artifacts in the
  present tense. Every one of those sentences is now false.

  This is a documentation-only correction. The aider-based qwen-mono-router is a
  different, pre-existing seat that this supersede never touched, and it stays.

  Background:
    Given the qwen-code mono-router seat has been removed from the tree

  # BL-1087 qwen-code-doc-drift-01
  Scenario: The runbook for the withdrawn seat is no longer published
    When the tree is inspected
    Then "docs/how-to/BL-1052-qwen-code-mono-router-launch.md" is not present

  # BL-1087 qwen-code-doc-drift-02
  Scenario: The documentation index no longer advertises the withdrawn runbook
    When the documentation index is inspected
    Then it carries no link to "how-to/BL-1052-qwen-code-mono-router-launch.md"

  # BL-1087 qwen-code-doc-drift-03
  Scenario Outline: A removed artifact survives only in the shipped-work log
    Given "<artifact>" is absent from the tree
    When the documentation tree is searched for "<artifact>"
    Then the only file mentioning it is "docs/reference/Specification.MD"

    Examples:
      | artifact                                    |
      | swarmforge/packs/qwen-code-mono-router.conf |
      | test_qwen_code_seat.sh                      |
      | bl1052_qwen_code_seat_property_runner.bb    |
      | bl1053_qwen_provider_routing_test_runner.bb |

  # BL-1087 qwen-code-doc-drift-04
  Scenario: The shipped-work log records the withdrawal rather than a false present
    When the shipped-work log entries for BL-1052 and BL-1053 are read
    Then each records that the seat was superseded and removed
    And each names "backlog/evidence/BL-1052-BL-1053-supersede-disposition-20260823.md"

  # BL-1087 qwen-code-doc-drift-05
  Scenario: Removing the runbook leaves no dead link behind it
    When every relative markdown link in the documentation index is followed
    Then each one resolves to a file that is present

  # BL-1087 qwen-code-doc-drift-06
  Scenario Outline: The pre-existing aider-based qwen seat is left untouched
    When the tree is inspected
    Then "<kept>" is present

    Examples:
      | kept                                   |
      | swarmforge/packs/qwen-mono-router.conf |
      | start-swarm-qwen.sh                    |

  # BL-1087 qwen-code-doc-drift-07
  Scenario: A documented placeholder pack name is not reported as drift
    Given the shipped-work log illustrates pack naming with the placeholder "swarmforge/packs/NAME.conf"
    When the documentation tree is checked for packs it names but does not have
    Then the placeholder is not reported
    And a real pack name that is absent from the tree is reported
