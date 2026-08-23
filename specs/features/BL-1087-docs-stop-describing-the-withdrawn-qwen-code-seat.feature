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
