# mutation-stamp: sha256=e3686d3f9a3849f38fd7b80f9725039fb941de15944aeaa53c99eae5385db415
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-20T07:46:25.038951Z","feature_name":"BL-964 wrong-prefix ensure env-var regression gate","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-964-wrong-prefix-ensure-env-var-regression-gate.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the gate fails naming a file that reintroduces the retired prefix","scenario_hash":"d03bf211d26e9dfa3de28aae9b7cc7231595a4a73d932e173b885d4461fe48aa","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-20T07:46:25.038951Z"}]}
# acceptance-mutation-manifest-end

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
