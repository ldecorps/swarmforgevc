Feature: A role seat can be staffed by qwen-code

  qwen-code is Alibaba's own agentic CLI and really executes shell commands,
  unlike the aider-based Qwen path already in the swarm, which shares the same
  models and key but cannot execute at all. Capability entries describe the
  AGENT, not the model, so the two must never share a shape.

  The ModelFactory provider->agent entry and the Model Steward cost-class
  registration are BL-1053, and the trial run is operational; neither is
  asserted here.

  # BL-1052 qwen-code-seat-01
  Scenario: qwen-code is registered as a shell-capable agent
    When the capabilities for agent "qwen-code" are read
    Then its wake style is "chat-message"
    And its bootstrap style is "embedded"

  # BL-1052 qwen-code-seat-02
  Scenario: the aider-based Qwen path keeps its own distinct shape
    When the capabilities for agent "aider" are read
    Then its wake style is "shell-run-script"
    And its bootstrap style differs from the shape of agent "qwen-code"

  # BL-1052 qwen-code-seat-03
  Scenario: the launch command invokes the CLI in non-interactive execution mode
    Given a window line staffing role "coder" with agent "qwen-code" and model "qwen3.7-plus"
    When the launch command for that window is composed
    Then it invokes "qwen" with auth type "openai"
    And it selects model "qwen3.7-plus"
    And it enables non-interactive shell execution

  # BL-1052 qwen-code-seat-04
  Scenario: the role prompt is embedded in the launch command
    Given a window line staffing role "coder" with agent "qwen-code" and model "qwen3.7-plus"
    When the launch command for that window is composed
    Then the composed command carries the role's bootstrap prompt

  # BL-1052 qwen-code-seat-05
  Scenario Outline: the credential reaches the pane through the environment, never a file
    Given "<key>" is exported in the launching environment
    When the launch command for a "qwen-code" window is composed
    Then the composed command does not contain the credential value
    And the pane receives the OpenAI-compatible endpoint for the Token Plan

    Examples:
      | key                         |
      | QWEN_API_KEY                |
      | BAILIAN_CODING_PLAN_API_KEY |

  # BL-1052 qwen-code-seat-06
  Scenario: the new pack carries the terms-of-service caution
    When the pack file "qwen-code-mono-router.conf" is read
    Then it warns that a headless swarm may risk key revocation on a Personal plan

  # BL-1052 qwen-code-seat-07
  Scenario: the existing aider-based pack is left alone
    When the pack file "qwen-mono-router.conf" is read
    Then it still names agent "aider" for every role window
