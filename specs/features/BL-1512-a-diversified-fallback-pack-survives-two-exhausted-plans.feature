Feature: BL-1512 A diversified fallback pack survives b.ai and Anthropic being exhausted together

  Every seat's first fallback is Anthropic, so anthropic-mono-router.conf
  already IS the tier-1 fallback pack. What is missing is a tier-2 pack
  for the case where BOTH b.ai and Anthropic are exhausted at once: one
  certified pick per seat from another plan, chosen for provider
  diversity so one exhausted plan degrades one tier, not the whole swarm.
  This feature is that pack, its header rationale, and the proof that
  every seat it names is certified for its role and accepted by the
  staffing gate.

  # BL-1512 diversified-fallback-pack-01
  Scenario: every pipeline seat is staffed from a plan that is neither b.ai nor Anthropic
    When candidate-diversified-fallback-mono-router.conf is parsed
    Then each of specifier, coder, cleaner, architect, hardender, documenter and QA has one window line
    And none of those lines resolves to the anthropic or the tencentcloud2 provider

  # BL-1512 diversified-fallback-pack-02
  Scenario: every seat's model is certified for that role in the steward registry
    When each window line's model is checked with the steward's eligible command for its role
    Then every one is eligible without the uncertified override

  # BL-1512 diversified-fallback-pack-03
  Scenario: the staffing gate passes every window line without the override hatch
    Given PACK_STAFFING_SKIP_GATE is unset
    When the pack staffing gate runs on the pack
    Then every window line reads pass

  # BL-1512 diversified-fallback-pack-04
  Scenario: the coordinator seat follows the human ruling and the header says what was proven
    When the pack header is read
    Then the coordinator seat matches the ticket's human ruling
    And the header states which coordinator picks were proven live and which were not
