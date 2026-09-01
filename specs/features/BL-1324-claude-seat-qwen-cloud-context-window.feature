Feature: a claude seat whose --model is qwen* gets Token Plan billing and a real 1M context window

  # BL-1324 stamp-off for landed hotfix 4ed88430b2 (BL-848 certification
  # ledger). The behaviour below is ALREADY in production — this feature
  # certifies it through the full gate stack rather than re-specifying a
  # rebuild. Before this hotfix, Claude Code sized an unrecognized qwen*
  # gateway model id at roughly 50k tokens and auto-compacted mid-ticket,
  # even though the underlying Token Plan qwen3.* model is a real 1M-token
  # window; a claude seat that had not opted in via SWARMFORGE_USE_QWEN=1
  # also had no route onto the Token Plan endpoint at all, so a mixed pack
  # (some seats Anthropic, some seats Qwen) could not staff a Qwen seat with
  # the claude agent.

  Background:
    Given swarmforge.sh's launch helpers are sourced with no operator profile

  # BL-1324 extra-cli-detects-qwen-model-flag-01
  Scenario Outline: extra_cli_targets_qwen_cloud detects a qwen* --model token
    Given a role's extra CLI args string is "<extra_cli>"
    When extra_cli_targets_qwen_cloud is called with that string
    Then it returns <result>

    Examples:
      | extra_cli                                | result |
      | --model qwen3.8-max --effort high        | true   |
      | --model claude-sonnet-5 --effort high    | false  |
      | --effort high                            | false  |
      | --model=qwen3.8-max --effort high        | false  |

  # BL-1324 qwen-targeted-claude-seat-remaps-billing-guard-02
  Scenario: a claude seat whose own --model is qwen* rides the Token Plan endpoint without the global opt-in
    Given a claude role's extra CLI is "--model qwen3.8-max --dangerously-skip-permissions --effort high"
    And SWARMFORGE_USE_QWEN is not set
    When the role's billing guard is built
    Then the billing guard maps ANTHROPIC_* onto the Token Plan Anthropic-compat endpoint
    And the billing guard exports CLAUDE_CODE_MAX_CONTEXT_TOKENS

  # BL-1324 sibling-anthropic-seat-not-remapped-03
  Scenario: a sibling claude seat whose --model is not qwen* keeps first-party Anthropic auth
    Given a claude role's extra CLI is "--model claude-sonnet-5 --dangerously-skip-permissions --effort high"
    And SWARMFORGE_USE_QWEN is not set
    When the role's billing guard is built
    Then the billing guard does not map onto the Token Plan endpoint

  # BL-1324 context-tokens-respects-existing-override-04
  Scenario: an already-exported CLAUDE_CODE_MAX_CONTEXT_TOKENS is preserved, not overwritten
    Given a claude role's extra CLI is "--model qwen3.8-max --effort high"
    And CLAUDE_CODE_MAX_CONTEXT_TOKENS is already exported as "500000"
    When the role's billing guard is built
    Then the exported CLAUDE_CODE_MAX_CONTEXT_TOKENS remains "500000"

  # BL-1324 launch-role-forwards-qwen-key-and-window-05
  Scenario: launch_role forwards the Qwen key and the context window into the pane env for a mixed-pack claude seat
    Given a claude role's extra CLI is "--model qwen3.8-max --effort high"
    And SWARMFORGE_USE_QWEN is not set
    And a QWEN_API_KEY credential is available
    When launch_role builds the pane env flags for that role
    Then the pane env flags carry QWEN_API_KEY
    And the pane env flags carry CLAUDE_CODE_MAX_CONTEXT_TOKENS

  # BL-1324 pack-conf-stages-every-pipeline-seat-on-qwen-06
  Scenario: the mono-router pack stages every pipeline seat on qwen3.8-max and keeps the coordinator on Anthropic Max
    Given the bob-multi-provider-mono-router pack configuration
    When the pack's window lines are read
    Then every pipeline role's window line requests --model qwen3.8-max via the claude agent
    And the coordinator's window line requests claude-sonnet-5
