Feature: A feature file on main always resolves to a runnable step handler

  specs/pipeline/runtime.js THROWS on any scenario whose steps no registered
  handler matches. So a feature file can reach main carrying scenarios that
  cannot run, and the first role to run the suite inherits a red it did not
  cause. Nothing refuses that state at the moment it is created.

  Observed 2026-08-30 on BL-1253: a QA bounce-revert (403b75e44e) correctly
  removed a handler, its lib script and its index.js registration together,
  and a later merge resurrected the handler file and the feature file but
  neither the registration nor the lib. main carried 8 scenarios that all
  failed with "no step handler matched", and no gate had anything to say.

  This guard runs in the commit-guard chain, beside the guards that already
  refuse a bad main tip before it exists rather than reacting to it after.

  Background:
    Given a repository whose acceptance features live in "specs/features/"
    And a step registry at "specs/pipeline/steps/index.js"

  # BL-1303 feature-on-main-registered-handler-01
  Scenario: A feature whose every step resolves is allowed through
    Given a feature file whose every step matches a registered handler
    When the feature-handler registration guard runs on "main"
    Then the guard passes
    And it reports no offending feature

  # BL-1303 feature-on-main-registered-handler-02
  Scenario: A handler file present but unregistered is refused
    Given a feature file whose handler file exists but is absent from the step registry
    When the feature-handler registration guard runs on "main"
    Then the guard refuses
    And the refusal names the "offending feature file"
    And the refusal names the "unregistered handler"

  # BL-1303 feature-on-main-registered-handler-03
  Scenario: A registered handler whose sibling script is missing is refused
    Given a registered handler that executes a sibling script under "specs/pipeline/steps/lib/"
    And that sibling script is absent from the tree being committed
    When the feature-handler registration guard runs on "main"
    Then the guard refuses
    And the refusal names the "missing sibling script"

  # BL-1303 feature-on-main-registered-handler-04
  Scenario: One pass reports every offender
    Given a tree carrying <offenders> distinct unrunnable feature files
    When the feature-handler registration guard runs on "main"
    Then the guard refuses
    And the refusal names all <offenders> feature files

    Examples:
      | offenders |
      | 2         |
      | 3         |

  # BL-1303 feature-on-main-registered-handler-05
  Scenario: The guard is silent on a branch other than main
    Given a feature file whose handler file exists but is absent from the step registry
    When the feature-handler registration guard runs on "swarmforge-coder"
    Then the guard passes

  # BL-1303 feature-on-main-registered-handler-06
  Scenario: An unreadable step registry is refused, never waved through
    Given a step registry that cannot be read
    When the feature-handler registration guard runs on "main"
    Then the guard refuses
    And the refusal names the "unreadable step registry"
