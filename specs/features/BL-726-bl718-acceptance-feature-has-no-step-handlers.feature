Feature: BL-718 acceptance feature runs with real step handlers

  # BL-726: BL-718's feature file has never executed — every scenario fails
  # "no step handler matched" at runtime.js. Wire bl718BubbleTalkMirrorSteps
  # (or equivalent) registered from index.js, driving the real mirror/chunking
  # code. Companion pilot-process gate: BL-727 (done). Product behaviour
  # already covered by unit tests; this ticket makes the Gherkin gate real.

  Background:
    Given the BL-718 acceptance feature file exists under specs/features

  # BL-726 every-step-has-a-handler-01
  Scenario: every Given When Then in the BL-718 feature resolves to a registered handler
    When the BL-718 acceptance feature is executed through the pipeline CLI
    Then no scenario fails with no step handler matched

  # BL-726 handlers-drive-real-mirror-code-02
  Scenario: the step handlers call the real mirror and chunking entry points
    Given the BL-718 step handler module is registered in the pipeline steps index
    When the handler source is inspected
    Then it invokes the committed Bubble talk mirror or shared Telegram chunker
    And it does not assert against prompt text alone

  # BL-726 short-and-long-reply-scenarios-green-03
  Scenario Outline: mirror scenarios for short and long replies pass against real behaviour
    When the BL-718 scenario <scenario> is executed through the pipeline CLI
    Then that scenario passes

    Examples:
      | scenario                                      |
      | a short turn lands in the Bubble topic        |
      | a long reply is chunked instead of dropped    |

  # BL-726 mirror-failure-scenarios-green-04
  Scenario Outline: mirror failure and poll scenarios pass against real behaviour
    When the BL-718 scenario <scenario> is executed through the pipeline CLI
    Then that scenario passes

    Examples:
      | scenario                                                      |
      | a mirror send that fails is surfaced, never swallowed         |
      | choice polls keep working alongside the text mirror           |
      | a mirror failure does not fail the phone turn                 |

  # BL-726 full-feature-cli-green-05
  Scenario: the full BL-718 feature file completes green via the pipeline CLI
    When node specs/pipeline/cli.js runs the BL-718 bubble talk mirror feature
    Then every scenario passes
    And the run exits successfully
