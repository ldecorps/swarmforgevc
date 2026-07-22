Feature: PromptEngine is the single authority for all swarm prompt composition

  # BL-546 (human intake 2026-07-21): prompt construction is scattered across
  # agent_runtime_lib.bb, swarmforge.sh, pack overlays, and role prompts. As
  # provider support grows, each model needs different prompting strategies while
  # still adhering to the Constitution. PromptEngine centralises composition,
  # fragment reuse, and model adapters behind one API.
  #
  # SLICE 1 CONTRACT (this file): extract and centralise today's prompt assembly
  # behind a compose API; preserve BL-519 stable-prefix contract. Slices 2
  # (fragments + adapters) and 3 (versioning/validation/inspect) are parked in
  # BL-546-prompt-engine-slices-2-3.feature.draft — move each slice's scenarios
  # into this file when that slice is built.

  Background:
    Given the PromptEngine compose API is available
    And a standard seven-pack launch context with role "coder" and agent "claude"

  # BL-546 single-authority-compose-01
  Scenario: launch paths obtain system prompts only through PromptEngine
    When a role is prepared for launch
    Then the system prompt artifact is produced by PromptEngine compose
    And no launch script assembles prompt text directly

  # BL-546 bl519-stable-prefix-preserved-02
  Scenario: composed prompts preserve the BL-519 stable-prefix contract
    When PromptEngine composes a system prompt for a launched role
    Then it contains the inlined constitution and PIPELINE content
    And the inlined constitution and PIPELINE content appears before any role-specific content
    And no date, session id, ticket id, or resume-on-start note precedes the stable chunk

  # BL-546 stable-prefix-byte-identical-03
  Scenario: the stable prefix is byte-identical across two roles of the same compose path
    Given PromptEngine composes system prompts for roles "coder" and "cleaner"
    Then their inlined constitution-and-PIPELINE prefix is byte-identical

  # BL-546 deterministic-compose-04
  Scenario: deterministic mode yields byte-stable output for identical inputs
    Given PromptEngine is invoked twice with the same compose request and deterministic mode enabled
    Then both composed system prompts are byte-identical

  # BL-546 no-direct-agent-construction-07
  Scenario: swarm agents do not construct prompts directly
    Given a running swarm role pane
    When its bootstrap system prompt is generated
    Then the generation call chain includes PromptEngine compose
    And the role prompt file alone is not the sole system prompt source

  # BL-546 cache-warm-hash-delegation-08
  Scenario Outline: stable-prefix content hash tracks compose output for cache warm decisions
    Given a pack has been launched and its stable-prefix content hash recorded via PromptEngine
    When the pack is relaunched with stable prefix content "<change>"
    Then the warm step "<warm-outcome>"

    Examples:
      | change                | warm-outcome                |
      | unchanged             | reuses the still-warm cache |
      | constitution-changed  | re-warms the new prefix     |
      | model-routing-changed | re-warms the new prefix     |
