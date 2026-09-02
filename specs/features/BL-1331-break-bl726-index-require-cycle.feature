Feature: The BL-718 meta-acceptance step module no longer requires the step index it lives in

  bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js is itself one of the
  files specs/pipeline/steps/index.js requires. It also lazily required
  index.js back, to build a second, independent step registry for one
  per-scenario check - a real require cycle dependency-cruiser's acyclic
  rule (BL-259) correctly flags. The fix reuses the ambient registry this
  module's own registerSteps(registry) already closes over, which is the
  exact same, fully-populated registry by the time any step executes.

  Background:
    Given the source of specs/pipeline/steps/bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js

  # BL-1331 break-bl726-index-require-cycle-01
  Scenario: the module no longer requires the step registry index at runtime
    Then the source contains no require of "./index"

  # BL-1331 break-bl726-index-require-cycle-02
  Scenario: the per-scenario meta-check takes the ambient registry as a parameter
    Then runBl718ScenarioByName accepts the registry as its first parameter
    And the step handler that calls it passes its own enclosing registry through

  # BL-1331 break-bl726-index-require-cycle-03
  Scenario Outline: the dependency gate reports no acyclic violation for this pair
    Given the parcel's changed files include "<file>"
    When the dependency gate runs
    Then no acyclic violation names "bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js"

    Examples:
      | file                                                                       |
      | specs/pipeline/steps/bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js  |
      | specs/pipeline/steps/index.js                                             |

  # BL-1331 break-bl726-index-require-cycle-04
  Scenario: the BL-718 meta-acceptance feature still passes unmodified
    When node specs/pipeline/cli.js runs the BL-726 bl718 acceptance feature
    Then every scenario passes
    And the run exits successfully
