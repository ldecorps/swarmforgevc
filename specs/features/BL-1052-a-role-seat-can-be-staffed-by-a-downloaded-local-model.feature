Feature: A role seat can be staffed by a downloaded local model

  A seat staffed by a downloaded model runs its completions on this host through
  an agent that really executes shell commands. The aider-based Qwen path
  already in the swarm shares the models but is a file editor that cannot
  execute, so the two must never share a capability shape: a capability entry
  describes the AGENT, not the model.

  Pulling and serving the model is BL-1082; the ModelFactory provider key and
  the Model Steward registration are BL-1053. Neither is asserted here.

  # BL-1052 local-model-seat-01
  Scenario: the local-model seat agent is registered as a shell-capable agent
    When the capabilities for agent "local-model" are read
    Then its wake style is "chat-message"
    And its bootstrap style is "embedded"

  # BL-1052 local-model-seat-02
  Scenario: the aider-based path keeps its own distinct shape
    When the capabilities for agent "aider" are read
    Then its wake style is "shell-run-script"
    And its bootstrap style differs from the shape of agent "local-model"

  # BL-1052 local-model-seat-03
  Scenario Outline: the launch command names the local endpoint and the chosen model
    Given a window line staffing role "coder" with agent "local-model" and model "<model>"
    When the launch command for that window is composed
    Then it targets the local inference endpoint on the loopback interface
    And it selects model "<model>"
    And it enables non-interactive shell execution

    Examples:
      | model                     |
      | qwen2.5-coder:7b-instruct |
      | llama3.1:8b               |

  # BL-1052 local-model-seat-04
  Scenario: the role prompt reaches the launched seat
    Given a window line staffing role "coder" with agent "local-model" and model "qwen2.5-coder:7b-instruct"
    When the launch command for that window is composed
    Then the composed command carries the role's bootstrap prompt

  # BL-1052 local-model-seat-05
  Scenario: the launch command holds no credential value
    Given a credential for the local endpoint is exported in the launching environment
    When the launch command for a "local-model" window is composed
    Then the composed command does not contain the credential value

  # BL-1052 local-model-seat-06
  Scenario: a seat is not launched against an endpoint that is not ready
    Given the local endpoint health check reports not ready
    When a "local-model" window is launched
    Then the launch is refused
    And the refusal names the endpoint that was not ready

  # BL-1052 local-model-seat-07
  Scenario: the new pack staffs every role window with the local-model agent
    When the new local-model pack file is read
    Then every role window names agent "local-model"
    And it requires no cloud provider API key

  # BL-1052 local-model-seat-08
  Scenario: the existing aider-based Qwen pack is left alone
    When the pack file "qwen-mono-router.conf" is read
    Then it still names agent "aider" for every role window
