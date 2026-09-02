Feature: Swarm stamp-off for the bob pack Anthropic-starting-cast restaff

  Hotfix 441fd35112 landed on main outside the pipeline. These scenarios
  review what it landed - they confirm or refute it and never reimplement
  it. The certification itself is a human decision recorded in the hotfix
  ledger; nothing here may write it.

  Background:
    Given the landed sources at commit 441fd35112

  # BL-1330 swarm-stamp-bob-anthropic-starting-cast-01
  Scenario Outline: the bob pack staffing is as landed
    Given the bob-multi-provider-mono-router pack
    When the window block is read
    Then the window for role "<role>" names the claude agent
    And the window for role "<role>" names model "<model>"
    And the window for role "<role>" carries effort "<effort>"

    Examples:
      | role       | model            | effort |
      | coder      | qwen3.8-max      | high   |
      | specifier  | claude-sonnet-5  | high   |
      | cleaner    | claude-sonnet-5  | medium |
      | architect  | claude-sonnet-5  | high   |
      | hardender  | claude-sonnet-5  | medium |
      | documenter | claude-sonnet-5  | medium |
      | QA         | claude-sonnet-5  | high   |

  # BL-1330 swarm-stamp-bob-anthropic-starting-cast-02
  # Corrected 2026-09-02. The original second clause read "the diff of commit
  # 441fd35112 touches no coordinator-related line" and is unsatisfiable: the
  # commit reworded six coordinator COMMENT lines while describing the new
  # cast, which is exactly what a restaff commit should do. That clause
  # asserted over diff TEXT rather than behaviour, so it would have refused a
  # correct hotfix over comment churn. What matters, and what is true, is that
  # the coordinator's staffing itself did not move.
  Scenario: the coordinator's staffing is unchanged by this commit
    Given the bob-multi-provider-mono-router pack
    When the window block is read
    Then no window line names role "coordinator"
    And the coordinator agent, model and effort are unchanged by commit 441fd35112

  # BL-1330 swarm-stamp-bob-anthropic-starting-cast-03
  Scenario: exactly one seat targets the Qwen Token Plan gateway
    Given the bob-multi-provider-mono-router pack
    When each window's --model value is checked against the remap predicate
    Then only the coder window targets the Qwen cloud gateway
    And every other window carries no Token Plan remap

  # BL-1330 swarm-stamp-bob-anthropic-starting-cast-04
  Scenario: the 1M context declaration and Qwen credential stay scoped to the coder seat
    Given the bob pack launch scripts generated from the landed conf
    Then only the coder seat's launch script declares CLAUDE_CODE_MAX_CONTEXT_TOKENS
    And only the coder seat's pane env carries QWEN_API_KEY
    And no other seat's launch script or pane env carries either

  # BL-1330 swarm-stamp-bob-anthropic-starting-cast-05
  Scenario: no script or library code changed in this commit
    When the review inspects the commit's changed paths
    Then the only changed file under swarmforge/ is the bob pack conf
    And no file under swarmforge/scripts/ or extension/ appears in the diff

  # BL-1330 swarm-stamp-bob-anthropic-starting-cast-06
  Scenario: the review never certifies the hotfix by itself
    When the review completes with every scenario green
    Then the hotfix ledger entry for commit 441fd35112 is still awaiting a human decision
