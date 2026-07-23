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
