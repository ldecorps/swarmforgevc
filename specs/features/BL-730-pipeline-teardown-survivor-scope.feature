# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-13T06:22:57.054655Z","feature_name":"Pipeline teardown reports survivors from its own root only","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-730-pipeline-teardown-survivor-scope.feature","background_hash":"d676f0d2a6bcd596f1aaccfb8932d9ae06717e49fdbcdd6dfeee64c1f98508a6","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: Pipeline teardown reports survivors from its own root only

  Background:
    Given a pipeline teardown of the root "/repos/alpha"

  # BL-730 pipeline-teardown-survivor-scope-01
  Scenario Outline: a process counts as a survivor only when it belongs to the root being torn down
    Given a running process "<argv>"
    When the teardown checks for survivors
    Then the survivor report names that process: "<named>"

    Examples:
      | argv                                                        | named |
      | bb /repos/alpha/swarmforge/scripts/handoffd.bb /repos/alpha | yes   |
      | bb /repos/beta/swarmforge/scripts/handoffd.bb /repos/beta   | no    |
      | copilot --project /repos/alpha SwarmForge                   | yes   |
      | copilot --project /repos/beta SwarmForge                    | no    |

  # BL-730 pipeline-teardown-survivor-scope-02
  Scenario Outline: the exit status follows whether the teardown's own root left anything behind
    Given a running process "<argv>"
    When the teardown checks for survivors
    Then the teardown exit status is "<status>"

    Examples:
      | argv                                                        | status   |
      | bb /repos/beta/swarmforge/scripts/handoffd.bb /repos/beta   | zero     |
      | bb /repos/alpha/swarmforge/scripts/handoffd.bb /repos/alpha | non-zero |

  # BL-730 pipeline-teardown-survivor-scope-03
  Scenario: the scanning shell never reports itself
    Given no running process belongs to the root being torn down
    And the scanning shell's own command line mentions "handoffd.bb"
    When the teardown checks for survivors
    Then the teardown exit status is "zero"
    And the survivor report is empty
