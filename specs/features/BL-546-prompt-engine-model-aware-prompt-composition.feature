Feature: PromptEngine is the single authority for all swarm prompt composition

  # BL-546 (human intake 2026-07-21): prompt construction is scattered across
  # agent_runtime_lib.bb, swarmforge.sh, pack overlays, and role prompts. As
  # provider support grows, each model needs different prompting strategies while
  # still adhering to the Constitution. PromptEngine centralises composition,
  # fragment reuse, and model adapters behind one API. These scenarios pin Slice 1
  # (extract + centralise) and Slice 2 (fragments + adapters) contracts.
  # Slice 3 (versioning/validation/inspect) scenarios are marked for a follow-on
  # implementation pass once Slice 2 lands.

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

  # BL-546 fragment-assembly-05
  Scenario Outline: PromptEngine assembles prompts from named fragments
    Given the compose request includes fragment "<fragment>"
    When PromptEngine composes the system prompt
    Then the composed prompt includes content from fragment "<fragment>"

    Examples:
      | fragment        |
      | constitution    |
      | pipeline        |
      | role            |
      | pack-overlay    |

  # BL-546 model-adapter-selection-06
  Scenario Outline: model-specific adapters adjust prompt wording without forking the constitution
    Given the compose request targets model "<model>" on provider "<provider>"
    When PromptEngine applies the model adapter
    Then the adapter id is "<adapter>"
    And the constitution fragment content is unchanged
    And tool instructions match the adapter shape for "<provider>"

    Examples:
      | provider | model              | adapter        |
      | claude   | claude-sonnet-5    | generic        |
      | aider    | mistral-large      | aider-editor   |

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

  @slice-3
  # BL-546 validation-rejects-invalid-09
  Scenario: validation rejects a compose result with volatile content before the stable chunk
    Given a compose request that would place volatile content before the stable chunk
    When PromptEngine validates the composed prompt
    Then validation fails with a stable-ordering error

  @slice-3
  # BL-546 inspect-manifest-10
  Scenario: inspect mode exposes the composed prompt and fragment hash manifest
    Given PromptEngine has composed a system prompt for role "coder"
    When an operator requests prompt inspection for that role
    Then the inspection output includes the full composed prompt
    And a fragment hash manifest with no secret values
