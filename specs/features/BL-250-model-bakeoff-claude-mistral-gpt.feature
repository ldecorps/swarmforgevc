# mutation-stamp: sha256=fdfa4d25b1f1541e1f50c131bc7fd9a7d834f4a2f5fdd6aaae8a7a681d3b7b62
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-10T14:52:08.160011845Z","feature_name":"a curated bake-off runs all available Claude, Mistral, and GPT models through the compliance battery and ranks best-value per role","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-250-model-bakeoff-claude-mistral-gpt.feature","background_hash":"6a9621664b770245d25175e66c28bc9678acf53af51d22906c278dc8591d4ee6","implementation_hash":"unknown","scenarios":[{"index":1,"name":"each candidate is labeled by its cost tier with its plan cost","scenario_hash":"29cb874598067313d6b7e50fea571b69ff2afd093ae50336d94c3ceb7cd6f2f4","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-07-10T14:52:08.160011845Z"}]}
# acceptance-mutation-manifest-end

Feature: a curated bake-off runs all available Claude, Mistral, and GPT models through the compliance battery and ranks best-value per role

  # Purpose (operator 2026-07-10): a companion to BL-233. Instead of BL-233's open
  # web-discovery of arbitrary cheap plans, this feeds a FIXED three-provider
  # candidate set — every agent-capable (chat/completion) model that Claude
  # (Anthropic), Mistral, and GPT (OpenAI) expose that we can access — through the
  # recruiter/battery pipeline, and produces a per-role best-value leaderboard
  # across all of them. Operator choices: (1) FULL best-value leaderboard, not
  # compliance-only; (2) test the WHOLE available roster per provider, not a
  # hand-picked subset; (3) the report FLAGS paid-only candidates distinctly.
  #
  # REUSE: qualify-via-battery (BL-231), driving non-Claude candidates
  # (provider abstraction BL-206-209), and acquire/qualify/rank/report
  # (BL-233 slices 2-4) are reused unchanged. The NOVEL surface here is the
  # fixed three-provider roster source (agent-capable models + cost + paid-only
  # flag) and the paid-only cost-tier label in the report.
  #
  # SLICED DELIVERY (see BL-250): this ticket shipped in slices, mirroring
  # BL-233's own scoping rule. All six scenarios are now built: the roster
  # adapter (01), cost-tier label (03), and the remaining four (ranking-02,
  # untested-listed-04, recommend-not-adopt-05, key-never-committed-06),
  # each reusing BL-233's rank.ts/orchestrator.ts/recommend.ts/acquire.ts/
  # secretStore.ts unchanged - "built" there meant wiring the bake-off's
  # own roster source through them. Nothing remains in a parked
  # .feature.draft companion.

  Background:
    Given the bake-off runs out-of-band over a fixed Claude, Mistral, and GPT candidate set, reusing the compliance battery, the provider abstraction, and the recruiter ranking, without modifying live swarm config

  # BL-250 roster-enumerates-01
  Scenario: the roster lists each provider's agent-capable models with cost and a paid-only label
    Given the bake-off enumerates the available models for Claude, Mistral, and GPT
    When roster discovery completes
    Then it lists each candidate's provider, model id, and plan cost
    And each candidate is marked as paid-only or free/eval-tier
    And non-chat endpoints are excluded from the roster

  # BL-250 cost-tier-labeled-03
  Scenario Outline: each candidate is labeled by its cost tier with its plan cost
    Given a compliant candidate whose cost tier is "<tier>"
    When the bake-off emits its report
    Then the report labels that candidate "<tier>" and shows its plan cost

    Examples:
      | tier           |
      | paid-only      |
      | free/eval-tier |

  # BL-250 best-value-leaderboard-02
  Scenario: each role gets a best-value leaderboard over compliant candidates across all three providers
    Given several candidates across Claude, Mistral, and GPT scored by the battery for a role
    When the bake-off ranks them for that role
    Then only battery-compliant candidates are ranked
    And they are ordered by capability weighted against plan cost, cheapest breaking ties
    And the current model for that role appears as the reference baseline
    And a best-value model is recommended for that role

  # BL-250 inaccessible-listed-04
  Scenario: a candidate that could not be accessed is listed as untested, not dropped
    Given a rostered candidate the bake-off could not access
    When the bake-off emits its report
    Then that candidate is listed as untested with the reason

  # BL-250 recommend-not-adopt-05
  Scenario: the bake-off recommends a config change but never applies it
    Given a best-value recommendation for a role
    When the bake-off emits its report
    Then the report includes a suggested swarmforge.conf --model change for that role
    And the bake-off does not modify swarmforge.conf or bounce the swarm

  # BL-250 key-never-committed-06
  Scenario: any provider key used stays in the host secret store and never in the tree
    Given the bake-off acquires or uses a provider API key
    When it stores the key
    Then the key is stored in the host secret store only
    And the key is never written to the working tree or any commit
