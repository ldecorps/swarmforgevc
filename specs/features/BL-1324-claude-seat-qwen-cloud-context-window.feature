# mutation-stamp: sha256=c5edaab43edc61bc048f60a0d248e0f5dee345ef466ce70b57aa63ddbe6e9f1f
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-02T12:19:36.996092956Z","feature_name":"a claude seat whose --model is qwen* gets Token Plan billing and a real 1M context window","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature","background_hash":"2cc1ed8676ef6e3b4c5e22278d5964dc793a7be13d04f839ac572bb3281674ee","implementation_hash":"unknown","scenarios":[{"index":0,"name":"extra_cli_targets_qwen_cloud detects a qwen* --model token","scenario_hash":"1fd342882715b4939499dfe6e92fe95684e185c5a2dbfe4cb7e1fec1b4323313","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-09-02T12:19:36.996092956Z"}]}
# acceptance-mutation-manifest-end

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
      # RETIRED by BL-1328 (2026-09-03): the row asserting
      # `--model=qwen3.8-max --effort high -> false` documented the
      # single-token detection GAP as certified behaviour. BL-1324's own human
      # ruling authorized closing that gap, and BL-1328 did; the assertion is
      # therefore superseded, and BL-1006 retires a superseded boundary rather
      # than rewording it (flipping false->true would have left this contract
      # asserting behaviour BL-1324 never shipped). The successor coverage is
      # BL-1328's own Outline, which asserts `--model=qwen3.8-max -> reports`
      # and `--model=claude-sonnet-5 -> does not report`. The other three rows
      # above stay: each is still true, and the space-form negative and the
      # no-model case exist nowhere else.

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

  # BL-1324 global-flag-packs-share-the-declaration-07
  # Carried from the retired duplicate BL-1325 (superseded-by-BL-1324):
  # a genuinely distinct check this feature did not otherwise cover.
  Scenario: the global-flag packs share the 1M declaration; reported, not undone
    Given a claude role's extra CLI is "--model qwen3.8-max --effort high"
    And SWARMFORGE_USE_QWEN is set to "1"
    When the role's billing guard is built
    Then the review records that a seat under the global SWARMFORGE_USE_QWEN=1 flag also declares CLAUDE_CODE_MAX_CONTEXT_TOKENS
    And that behaviour is left as the commit landed it

  # BL-1324 review-never-self-certifies-08
  # Carried from the retired duplicate BL-1325 (superseded-by-BL-1324):
  # pins invariant 2 (green tests never write the ledger decision) as an
  # explicit scenario rather than leaving it to qa_e2e_procedure prose alone.
  Scenario: the review never certifies the hotfix by itself
    When the review completes with every scenario green
    Then the hotfix ledger entry for commit 4ed88430b2 is still awaiting a human decision
