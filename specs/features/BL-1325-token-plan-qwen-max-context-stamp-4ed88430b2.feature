Feature: Swarm stamp-off for the Token Plan qwen3.8-max seat remap and 1M window declaration

  Hotfix 4ed88430b2 landed on main outside the pipeline. These scenarios
  review what it landed - they confirm or refute it and never reimplement
  it. The certification itself is a human decision recorded in the hotfix
  ledger; nothing here may write it.

  Background:
    Given the landed sources at commit 4ed88430b2

  # BL-1325 token-plan-max-context-stamp-01
  Scenario Outline: the seat remap predicate recognises qwen models in the seat CLI
    Given a seat whose pack CLI is "<cli>"
    When the remap predicate decides
    Then the seat targets the Qwen cloud gateway "<targets>"

    Examples:
      | cli                                  | targets |
      | --model qwen3.8-max                  | yes     |
      | --model qwen3.7-plus                 | yes     |
      | --model claude-sonnet-5              | no      |
      | --effort high                        | no      |
      | --dangerously-skip-permissions --model | no    |

  # BL-1325 token-plan-max-context-stamp-02
  Scenario: a mixed pack remaps only its qwen seat and keeps the sibling on subscription
    Given a mixed pack with no global SWARMFORGE_USE_QWEN
    And a claude seat whose pack CLI is "--model qwen3.8-max"
    And a claude seat whose pack CLI is "--model claude-sonnet-5"
    When the launcher builds both launch scripts
    Then the qwen seat's launch script remaps to the Token Plan anthropic-compat gateway
    And the qwen seat's launch script declares CLAUDE_CODE_MAX_CONTEXT_TOKENS with the 1000000 default
    And the sonnet seat's launch script carries no Token Plan remap

  # BL-1325 token-plan-max-context-stamp-03
  Scenario: pane env carries the key and the window without the global flag
    Given a mixed pack with no global SWARMFORGE_USE_QWEN
    And a claude seat whose pack CLI is "--model qwen3.8-max"
    When launch_role prepares the pane env flags for that seat
    Then the pane env flags carry QWEN_API_KEY
    And the pane env flags carry CLAUDE_CODE_MAX_CONTEXT_TOKENS with the 1000000 default

  # BL-1325 token-plan-max-context-stamp-04
  Scenario: the global-flag packs share the 1M declaration; reported, not undone
    Then the review records that seats under a global SWARMFORGE_USE_QWEN=1 now also declare the 1M window
    And that behaviour is left as the commit landed it

  # BL-1325 token-plan-max-context-stamp-05
  Scenario Outline: the bob pack staffing is as landed
    Given the bob-multi-provider-mono-router pack
    When the window block is read
    Then the window for role "<role>" names the claude agent
    And the window for role "<role>" names model qwen3.8-max
    And the window for role "<role>" carries effort "<effort>"

    Examples:
      | role       | effort |
      | coder      | high   |
      | specifier  | high   |
      | cleaner    | medium |
      | architect  | high   |
      | hardender  | medium |
      | documenter | medium |
      | QA         | high   |

  # BL-1325 token-plan-max-context-stamp-06
  Scenario: the review never certifies the hotfix by itself
    When the review completes with every scenario green
    Then the hotfix ledger entry for commit 4ed88430b2 is still awaiting a human decision
