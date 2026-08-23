Feature: The intelligence layer can route work to a local-model seat

  ModelFactory resolves a model's launch CLI through a provider to agent map
  that knows cloud providers only. A local endpoint speaks the
  OpenAI-compatible protocol, so registering an on-host model under the openai
  key looks right and resolves to a cloud CLI - launching the local model
  through the wrong binary, failing confusingly rather than loudly. On-host
  models need their own provider key.

  The seat path itself is BL-1052 and the pull and serve path is BL-1082;
  neither is asserted here.

  # BL-1053 local-provider-routing-01
  Scenario: the local provider resolves to the local-model seat agent
    When the launch agent for provider "local" is resolved
    Then it is the local-model seat agent

  # BL-1053 local-provider-routing-02
  Scenario Outline: the existing provider keys are unchanged
    When the launch agent for provider "<provider>" is resolved
    Then it is "<agent>"

    Examples:
      | provider  | agent  |
      | anthropic | claude |
      | openai    | codex  |
      | cerebras  | aider  |

  # BL-1053 local-provider-routing-03
  Scenario: an unknown provider fails loudly rather than falling through
    When the launch agent for provider "not-a-provider" is resolved
    Then the resolution reports the provider as unknown
    And it names no launch agent

  # BL-1053 local-provider-routing-04
  Scenario: a downloaded model registers under the local provider with a cost class
    When "qwen2.5-coder:7b-instruct" is registered as a candidate with cost class "low"
    Then the registry holds it under provider "local"
    And its cost class is "low"

  # BL-1053 local-provider-routing-05
  Scenario: a second downloaded model needs no new provider entry
    Given "qwen2.5-coder:7b-instruct" is registered under provider "local"
    When "llama3.1:8b" is registered as a candidate with cost class "low"
    Then the registry holds it under provider "local"
    And the provider to agent map is unchanged

  # BL-1053 local-provider-routing-06
  Scenario: registration alone changes no running seat
    Given a role seat is running on its launched model
    When "qwen2.5-coder:7b-instruct" is registered as a candidate with cost class "low"
    Then that seat is still running on its launched model
