Feature: BL-964 wrong-prefix ensure env-var regression gate

  Test code that exports fake ensure hooks under the retired
  SWARMFORGE_ENSURE_* prefix is silently ignored by swarm_ensure.bb and
  the real extension bounce runs, launching VS Code from a test. A
  standing gate must fail loud when the retired prefix reappears in test
  code, so the class cannot recur silently.

  # BL-964 wrong-prefix-gate-01
  Scenario Outline: the gate fails naming a file that reintroduces the retired prefix
    Given a scratch tree containing a test file under "<dir>" that sets "<var>"
    When the regression gate runs against that tree
    Then the gate fails naming that file and the retired string

    Examples:
      | dir                     | var                                |
      | swarmforge/scripts/test | SWARMFORGE_ENSURE_EXTENSION_CHECK  |
      | specs/pipeline/steps    | SWARMFORGE_ENSURE_EXTENSION_BOUNCE |
      | swarmforge/scripts/test | SWARMFORGE_ENSURE_SUPERVISOR       |

  # BL-964 wrong-prefix-gate-02
  Scenario: the gate passes on a tree using only the correct SWARM_ENSURE_*_CMD seams
    Given a scratch tree whose test files set only the SWARM_ENSURE_*_CMD env vars
    When the regression gate runs against that tree
    Then the gate passes
