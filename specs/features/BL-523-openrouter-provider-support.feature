# BL-523 openrouter-provider-support-01
Feature: OpenRouter provider support for claude-harness roles

  Background:
    Given a SwarmForge swarm with claude-harness roles configured
    And OPENROUTER_API_KEY is available in the environment

  # BL-523 openrouter-provider-support-01: Default behavior unchanged when SWARMFORGE_OPENROUTER_ROLES is empty
  Scenario: Default first-party auth when OpenRouter roles list is empty
    Given SWARMFORGE_OPENROUTER_ROLES is unset or empty
    When a claude-harness role starts
    Then the role uses first-party Anthropic subscription auth
    And ANTHROPIC_API_KEY is unset in the pane

  # BL-523 openrouter-provider-support-02
  Scenario: OpenRouter-backed documenter role uses OpenRouter endpoint
    Given SWARMFORGE_OPENROUTER_ROLES contains "documenter"
    When a claude-harness role starts
    Then ANTHROPIC_BASE_URL is set to "https://openrouter.ai/api"
    And ANTHROPIC_AUTH_TOKEN is set to the OPENROUTER_API_KEY value
    And ANTHROPIC_API_KEY is unset in the pane

  # BL-523 openrouter-provider-support-03
  Scenario Outline: Role routing based on SWARMFORGE_OPENROUTER_ROLES membership
    Given SWARMFORGE_OPENROUTER_ROLES contains "<openrouter_roles>"
    When a <role> claude-harness role starts
    Then the <role> <uses_endpoint>

    Examples:
      | openrouter_roles | role      | uses_endpoint                                      |
      | coder cleaner    | coder     | uses OpenRouter endpoint                          |
      | coder cleaner    | cleaner   | uses OpenRouter endpoint                          |
      | coder cleaner    | architect | uses first-party Anthropic subscription auth      |

  # BL-523 openrouter-provider-support-04
  Scenario: OpenRouter documenter role uses model from conf window line
    Given SWARMFORGE_OPENROUTER_ROLES contains "documenter"
    And the documenter window line specifies --model deepseek/deepseek-chat
    When a claude-harness role starts
    Then the harness receives model "deepseek/deepseek-chat"
    And the model is passed to OpenRouter's Anthropic-compatible endpoint

  # BL-523 openrouter-provider-support-05
  Scenario: Reversibility - removing role from list restores first-party auth
    Given SWARMFORGE_OPENROUTER_ROLES contains "documenter"
    When SWARMFORGE_OPENROUTER_ROLES no longer contains "documenter"
    And a claude-harness role starts
    Then the role uses first-party Anthropic subscription auth
