# mutation-stamp: sha256=755232d9c9e9d8ef0b0cb92b155ad94e8269613f6850374810be7bea4fea25b6
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T15:35:57.530510338Z","feature_name":"A shared pre-commit guard catches property-suite drift","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-570-property-suite-drift-guard.feature","background_hash":"04b5cfdbf4d7e46fccd6598ce0ff6292fe44ae760cd6eb7b8997c05d0037f3a7","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the guard runs the property suite only for staged changes that can invalidate a property","scenario_hash":"f891b49eabfb011a2dd4e7acfe25e192b9267ad38171b741f0d3a6666f793cba","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-24T15:35:57.530510338Z"}]}
# acceptance-mutation-manifest-end

Feature: A shared pre-commit guard catches property-suite drift

  The property suite (`npm run test:properties`) is deliberately excluded from
  the unit, coverage, mutation and CRAP runs, and no CI workflow runs any
  tests. Its only enforcement lives in the architect, hardener and QA role
  prompts, so a commit that never rides the pipeline can leave a property red
  indefinitely — exactly what d63e80320 did on 2026-07-22, undetected until an
  architect happened to run the suite during an unrelated review a day later.

  The repo already installs one guard that EVERY commit hits regardless of who
  or what makes it: the shared pre-commit hook (core.hooksPath), delegating to
  a standalone, testable script. This adds a second such guard for properties.

  It must never wedge the repository: when the toolchain is unavailable, or an
  operator is making a recovery commit, the guard yields rather than blocks.

  The suite's runnable state — "green", "red", or "unavailable" (its toolchain
  is not installed) — is the single precondition every scenario varies.

  Background:
    Given the shared pre-commit property guard is installed

  # BL-570 property-drift-guard-01
  Scenario Outline: the guard runs the property suite only for staged changes that can invalidate a property
    Given the property suite is "green"
    And the only staged change is "<staged_path>"
    When the property guard runs
    Then the guard "<suite_action>" the property suite
    And the commit is allowed

    Examples:
      | staged_path                                   | suite_action |
      | extension/src/pipelineBoard.ts                | runs         |
      | extension/test/pipelineBoard.property.test.js | runs         |
      | docs/diagrams/architecture.md                 | skips        |
      | backlog/paused/BL-999-example.yaml            | skips        |

  # BL-570 property-drift-guard-02
  Scenario: a staged source change that leaves a property red blocks the commit
    Given the property suite is "red"
    And the only staged change is "extension/src/pipelineBoard.ts"
    When the property guard runs
    Then the commit is blocked
    And the guard output names the failing property test file

  # BL-570 property-drift-guard-03
  Scenario: the guard fails open when the property toolchain is unavailable
    Given the property suite is "unavailable"
    And the only staged change is "extension/src/pipelineBoard.ts"
    When the property guard runs
    Then the commit is allowed
    And the guard output warns that the property check was "skipped"

  # BL-570 property-drift-guard-04
  Scenario: an explicit override lets a recovery commit through a red suite
    Given the property suite is "red"
    And the only staged change is "extension/src/pipelineBoard.ts"
    And the property guard override is set
    When the property guard runs
    Then the commit is allowed
    And the guard output warns that the property check was "overridden"
