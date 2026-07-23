Feature: agent bootstrap inlines the constitution into a cacheable stable-first system-prompt prefix

  # BL-519 (operator-requested, 2026-07-18): today generic-bootstrap-text emits
  # "Read swarmforge/constitution.prompt ... / Read PIPELINE.md ... / Read roles/<role>.prompt"
  # instructions the agent executes at boot, so the (large, byte-identical-across-roles)
  # constitution lands in the conversation at full input-token price on EVERY respawn.
  # The fix moves that stable content INTO the appended system prompt as INLINED text,
  # ordered stable-shared-content-first, so an exact-byte prefix caches once per model tier
  # and respawns within the TTL serve it as a ~0.1x cache read. A launch-time warm step,
  # keyed to a content hash of the assembled stable prefix, avoids N parallel cold writes and
  # re-warms whenever the constitution or a pack's model routing changes.
  #
  # These scenarios pin the DETERMINISTIC, generation-observable contract of the new bootstrap
  # (what the generated appended-system-prompt text contains and how it orders, plus the
  # content-hash warm DECISION). The LIVE cache-read telemetry (usage.cache_read_input_tokens
  # > 0 across two respawns within the TTL, per-pack and per-tier) is not deterministically
  # drivable in an in-process acceptance step — it requires a live swarm and the Anthropic API
  # across respawns — so it is verified by QA's end-to-end procedure recorded on the ticket
  # (steps 2, 5, 6), not by an executable scenario here.

  # BL-519 constitution-inlined-not-read-01
  Scenario: the generated system prompt inlines the constitution instead of instructing a runtime read
    Given the appended system prompt generated for a launched role
    Then it contains the inlined constitution and PIPELINE content
    And it does not instruct the agent to Read the constitution at boot

  # BL-519 stable-content-ordered-first-02
  Scenario: stable shared content is ordered ahead of role-specific content
    Given the appended system prompt generated for a launched role
    Then the inlined constitution and PIPELINE content appears before any role-specific content

  # BL-519 no-volatile-before-stable-chunk-03
  Scenario: no volatile content precedes the stable cacheable chunk
    Given the appended system prompt generated for a launched role
    Then no date, session id, ticket id, or resume-on-start note precedes the stable chunk

  # BL-519 stable-prefix-byte-identical-across-packs-04
  Scenario: the stable prefix is byte-identical across two roles of different packs
    Given the appended system prompts generated for two roles built by the same bootstrap code path
    Then their inlined constitution-and-PIPELINE prefix is byte-identical

  # BL-519 warm-hash-tracks-stable-prefix-05
  Scenario Outline: the launch cache-warm decision tracks the stable-prefix content hash
    Given a pack has been launched and its stable-prefix content hash recorded
    When the pack is relaunched with the stable prefix content <change>
    Then the warm step <warm-outcome>

    Examples:
      | change                | warm-outcome                |
      | unchanged             | reuses the still-warm cache |
      | constitution-changed  | re-warms the new prefix     |
      | model-routing-changed | re-warms the new prefix     |
