Feature: The intelligence layer can route work to a Qwen seat

  ModelFactory resolves a model's launch CLI through a provider->agent map
  that knows three providers, none of them qwen. Because qwen-code speaks the
  OpenAI-compatible protocol, registering its models under the openai key
  looks right and resolves to the codex CLI - launching qwen models through
  the wrong binary, failing confusingly rather than loudly.

  # BL-1053 qwen-provider-routing-01
  Scenario: the qwen provider resolves to the qwen-code launch agent
    When the launch agent for provider "qwen" is resolved
    Then it is the qwen-code launch agent

  # BL-1053 qwen-provider-routing-02
  Scenario Outline: the existing provider keys are unchanged
    When the launch agent for provider "<provider>" is resolved
    Then it is "<agent>"

    Examples:
      | provider  | agent  |
      | anthropic | claude |
      | openai    | codex  |
      | cerebras  | aider  |

  # BL-1053 qwen-provider-routing-03
  Scenario: an unknown provider fails loudly rather than falling through
    When the launch agent for provider "not-a-provider" is resolved
    Then the resolution reports the provider as unknown
    And it names no launch agent

  # BL-1053 qwen-provider-routing-04
  Scenario: a Token Plan model registers under the qwen provider with a cost class
    When "qwen3.7-plus" is registered as a candidate with cost class "low"
    Then the registry holds it under provider "qwen"
    And its cost class is "low"

  # BL-1053 qwen-provider-routing-05
  Scenario: registration alone changes no running seat
    Given a role seat is running on its launched model
    When "qwen3.7-plus" is registered as a candidate with cost class "low"
    Then that seat is still running on its launched model
