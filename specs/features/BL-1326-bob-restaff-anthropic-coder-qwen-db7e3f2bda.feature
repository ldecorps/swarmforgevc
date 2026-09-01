Feature: Swarm stamp-off for the bob pack restaff to an Anthropic starting cast with a coder-only Qwen Token Plan seat

  Hotfix db7e3f2bda landed on main outside the pipeline. These scenarios
  review what it landed - they confirm or refute it and never reimplement
  it. The certification itself is a human decision recorded in the hotfix
  ledger; nothing here may write it.

  Background:
    Given the landed sources at commit db7e3f2bda

  # BL-1326 bob-restaff-anthropic-coder-qwen-01
  Scenario Outline: the window staffing matches the Anthropic-starting-cast table
    Given the bob-multi-provider-mono-router pack
    When the window block is read
    Then the window for role "<role>" names the claude agent
    And the window for role "<role>" names model "<model>"
    And the window for role "<role>" carries effort "<effort>"

    Examples:
      | role       | model           | effort |
      | coder      | qwen3.8-max     | high   |
      | specifier  | claude-sonnet-5 | high   |
      | cleaner    | claude-sonnet-5 | medium |
      | architect  | claude-sonnet-5 | high   |
      | hardender  | claude-sonnet-5 | medium |
      | documenter | claude-sonnet-5 | medium |
      | QA         | claude-sonnet-5 | high   |

  # BL-1326 bob-restaff-anthropic-coder-qwen-02
  Scenario: coder remains the sole seat matching the Qwen cloud remap predicate
    Given the bob-multi-provider-mono-router pack's window block
    When each window's pack CLI is evaluated against the qwen-cloud remap predicate
    Then only the window for role "coder" targets the Qwen cloud gateway
    And every other window targets no remap

  # BL-1326 bob-restaff-anthropic-coder-qwen-03
  Scenario: coordinator stays off the window list and on first-party Anthropic
    Given the bob-multi-provider-mono-router pack
    Then no window line names role "coordinator"
    And the pack's coordinator_agent config is "claude"
    And the pack's coordinator_model config is "claude-sonnet-5"

  # BL-1326 bob-restaff-anthropic-coder-qwen-04
  Scenario: header and PREREQ prose document the starting-cast intent and the new credential split
    Given the bob-multi-provider-mono-router pack's header comment
    Then the header states Anthropic is the starting point for every seat except the resident coder
    And the header warns against treating the file as an already-diversified multi-vendor mix
    And the PREREQ section names an Anthropic subscription for every non-coder seat
    And the PREREQ section names BAILIAN_TOKEN_PLAN_API_KEY or QWEN_API_KEY for the coder seat only

  # BL-1326 bob-restaff-anthropic-coder-qwen-05
  Scenario: the review never certifies the hotfix by itself
    When the review completes with every scenario green
    Then the hotfix ledger entry for commit db7e3f2bda is still awaiting a human decision
