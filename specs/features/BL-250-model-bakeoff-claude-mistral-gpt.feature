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
  # SLICED DELIVERY (see BL-250): this ticket ships in slices, mirroring
  # BL-233's own scoping rule - the acceptance runner
  # (specs/pipeline/runtime.js) THROWS on any scenario lacking a step handler,
  # so this file carries ONLY the scenarios for slices already BUILT. Currently
  # built: the roster adapter (01) and the cost-tier label (03). Ranking (02),
  # untested-listed (04), recommend-not-adopt (05), and key-never-committed (06)
  # are parked in the companion
  # BL-250-model-bakeoff-claude-mistral-gpt.slices-2-4-5-6.feature.draft and are
  # promoted into this file when their slice is implemented - each of those
  # already reuses BL-233's rank.ts/orchestrator.ts/recommend.ts/secretStore.ts
  # unchanged, so "built" there just means wiring the bake-off's own roster
  # source through them.

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
